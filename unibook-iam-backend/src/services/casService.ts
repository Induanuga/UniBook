// // src/services/casService.ts
// // CAS 2.0 ticket validation service.
// //
// // Flow:
// //   1. Frontend hits GET /auth/cas/login
// //   2. Backend redirects user to CAS server login page
// //   3. CAS redirects back to GET /auth/cas/callback?ticket=ST-xxxxx
// //   4. Backend calls CAS /serviceValidate to confirm the ticket
// //   5. CAS returns XML with the authenticated username
// //   6. Backend looks up (or creates) the user, issues a JWT

// import axios from 'axios';
// import { parseStringPromise } from 'xml2js';
// import { config } from '../config';

// export interface CasValidationResult {
//   success: true;
//   username: string;       // the netID / username from CAS (e.g. "cs21b001")
//   attributes: Record<string, string>; // any extra attributes CAS returns (email, name, etc.)
// }

// export interface CasValidationFailure {
//   success: false;
//   errorCode: string;
//   errorMessage: string;
// }

// export type CasResult = CasValidationResult | CasValidationFailure;

// /**
//  * Builds the URL that redirects the user to the CAS login page.
//  * CAS will redirect back to `serviceUrl` with a one-time ticket after login.
//  */
// export function buildCasLoginUrl(): string {
//   const params = new URLSearchParams({
//     service: config.cas.serviceUrl,
//   });
//   return `${config.cas.serverUrl}/login?${params.toString()}`;
// }

// /**
//  * Validates a CAS service ticket using the CAS 2.0 /serviceValidate endpoint.
//  * Returns the authenticated username on success.
//  *
//  * CAS 2.0 XML success response shape:
//  *   <cas:serviceResponse>
//  *     <cas:authenticationSuccess>
//  *       <cas:user>username</cas:user>
//  *       <cas:attributes>
//  *         <cas:email>user@university.edu</cas:email>
//  *         <cas:name>Full Name</cas:name>
//  *         ... any other attrs the CAS server is configured to release
//  *       </cas:attributes>
//  *     </cas:authenticationSuccess>
//  *   </cas:serviceResponse>
//  *
//  * CAS 2.0 XML failure response shape:
//  *   <cas:serviceResponse>
//  *     <cas:authenticationFailure code="INVALID_TICKET">
//  *       Ticket ST-xxx not recognized
//  *     </cas:authenticationFailure>
//  *   </cas:serviceResponse>
//  */
// export async function validateCasTicket(ticket: string): Promise<CasResult> {
//   const validateUrl = `${config.cas.serverUrl}/serviceValidate`;

//   const params = new URLSearchParams({
//     service: config.cas.serviceUrl,
//     ticket,
//   });

//   let xml: string;

//   try {
//     const response = await axios.get<string>(`${validateUrl}?${params.toString()}`, {
//       timeout: 8000, // 8s — fail fast if CAS is unreachable
//       responseType: 'text',
//     });
//     xml = response.data;
//   } catch (err: any) {
//     console.error(JSON.stringify({
//       level: 'ERROR',
//       message: 'CAS server unreachable',
//       error: err.message,
//     }));
//     return {
//       success: false,
//       errorCode: 'CAS_UNREACHABLE',
//       errorMessage: 'Could not reach the university authentication server. Please try again.',
//     };
//   }

//   // Parse XML
//   let parsed: any;
//   try {
//     parsed = await parseStringPromise(xml, {
//       explicitArray: false,
//       tagNameProcessors: [(name) => name.replace('cas:', '')],
//     });
//   } catch {
//     return {
//       success: false,
//       errorCode: 'CAS_PARSE_ERROR',
//       errorMessage: 'Unexpected response from CAS server.',
//     };
//   }

//   const serviceResponse = parsed?.serviceResponse;

//   // ── Authentication failure ────────────────────────────────────────────────
//   if (serviceResponse?.authenticationFailure) {
//     const failure = serviceResponse.authenticationFailure;
//     const code    = failure?.$ ?.code || 'UNKNOWN';
//     const message = typeof failure === 'string' ? failure : failure?._ || 'Authentication failed.';
//     return { success: false, errorCode: code, errorMessage: message.trim() };
//   }

//   // ── Authentication success ────────────────────────────────────────────────
//   if (serviceResponse?.authenticationSuccess) {
//     const authSuccess = serviceResponse.authenticationSuccess;
//     const username    = authSuccess?.user;

//     if (!username) {
//       return {
//         success: false,
//         errorCode: 'CAS_NO_USER',
//         errorMessage: 'CAS returned success but no username.',
//       };
//     }

//     // Extract any extra attributes the CAS server released
//     const rawAttrs = authSuccess?.attributes || {};
//     const attributes: Record<string, string> = {};

//     for (const [key, val] of Object.entries(rawAttrs)) {
//       if (typeof val === 'string') attributes[key] = val;
//       else if (typeof val === 'object' && val !== null) {
//         // xml2js sometimes wraps text as { _: 'value' }
//         const inner = (val as any)._ || JSON.stringify(val);
//         attributes[key] = inner;
//       }
//     }

//     return { success: true, username, attributes };
//   }

//   return {
//     success: false,
//     errorCode: 'CAS_UNKNOWN_RESPONSE',
//     errorMessage: 'Unrecognised response from CAS server.',
//   };
// }

// src/services/casService.ts
// CAS ticket validation service — compatible with CAS 2.0 and CAS 3.0.
// IIIT Hyderabad uses: https://login.iiit.ac.in/cas

import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { config } from '../config';

export interface CasValidationResult {
  success: true;
  username: string;
  attributes: Record<string, string>;
}

export interface CasValidationFailure {
  success: false;
  errorCode: string;
  errorMessage: string;
}

export type CasResult = CasValidationResult | CasValidationFailure;

/**
 * Builds the URL that redirects the user to the CAS login page.
 */
export function buildCasLoginUrl(): string {
  const params = new URLSearchParams({ service: config.cas.serviceUrl });
  // config.cas.serverUrl = https://login.iiit.ac.in/cas
  // Result:               https://login.iiit.ac.in/cas/login?service=...
  return `${config.cas.serverUrl}/login?${params.toString()}`;
}

/**
 * Validates a CAS service ticket.
 * Tries CAS 3.0 endpoint first (p3/serviceValidate), then falls back to CAS 2.0.
 * CAS 3.0 returns richer attributes (email, name, etc).
 */
export async function validateCasTicket(ticket: string): Promise<CasResult> {
  // CAS 3.0 → https://login.iiit.ac.in/cas/p3/serviceValidate
  // CAS 2.0 → https://login.iiit.ac.in/cas/serviceValidate
  const endpoints = [
    `${config.cas.serverUrl}/p3/serviceValidate`,
    `${config.cas.serverUrl}/serviceValidate`,
  ];

  const params = new URLSearchParams({
    service: config.cas.serviceUrl,
    ticket,
  });

  let xml: string | null = null;
  let lastError = '';

  for (const validateUrl of endpoints) {
    const fullUrl = `${validateUrl}?${params.toString()}`;

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'CAS: trying ticket validation',
      url: fullUrl,
    }));

    try {
      const response = await axios.get<string>(fullUrl, {
        timeout: 10000,
        responseType: 'text',
        // Some CAS servers redirect — follow them
        maxRedirects: 5,
        headers: {
          'Accept': 'application/xml, text/xml, */*',
        },
      });

      console.log(JSON.stringify({
        level: 'INFO',
        message: 'CAS: raw response',
        status: response.status,
        // Log first 500 chars of the XML so you can see exactly what CAS returns
        body: response.data?.slice(0, 500),
      }));

      xml = response.data;
      break; // got a response — stop trying other endpoints

    } catch (err: any) {
      lastError = err.message;
      console.error(JSON.stringify({
        level: 'ERROR',
        message: 'CAS: endpoint failed',
        url: fullUrl,
        error: err.message,
        status: err.response?.status,
        body: err.response?.data?.slice?.(0, 300),
      }));
      // Try the next endpoint
    }
  }

  if (!xml) {
    return {
      success: false,
      errorCode: 'CAS_UNREACHABLE',
      errorMessage: `Could not reach the university CAS server. ${lastError}`,
    };
  }

  // Parse the XML response
  let parsed: any;
  try {
    parsed = await parseStringPromise(xml, {
      explicitArray: false,
      tagNameProcessors: [(name) => name.replace('cas:', '').replace('ns2:', '')],
    });
  } catch (parseErr: any) {
    console.error(JSON.stringify({
      level: 'ERROR',
      message: 'CAS: XML parse failed',
      error: parseErr.message,
      xml: xml.slice(0, 300),
    }));
    return {
      success: false,
      errorCode: 'CAS_PARSE_ERROR',
      errorMessage: 'Unexpected response from CAS server.',
    };
  }

  console.log(JSON.stringify({
    level: 'INFO',
    message: 'CAS: parsed XML',
    parsed: JSON.stringify(parsed).slice(0, 500),
  }));

  const serviceResponse = parsed?.serviceResponse;

  // ── Authentication failure ────────────────────────────────────────────────
  if (serviceResponse?.authenticationFailure) {
    const failure = serviceResponse.authenticationFailure;
    const code    = failure?.$ ?.code || 'UNKNOWN';
    const message = typeof failure === 'string'
      ? failure
      : (failure?._ || failure?.['#text'] || 'Authentication failed.');
    return { success: false, errorCode: code, errorMessage: String(message).trim() };
  }

  // ── Authentication success ────────────────────────────────────────────────
  if (serviceResponse?.authenticationSuccess) {
    const authSuccess = serviceResponse.authenticationSuccess;
    const username    = authSuccess?.user;

    if (!username) {
      return {
        success: false,
        errorCode: 'CAS_NO_USER',
        errorMessage: 'CAS returned success but no username.',
      };
    }

    // Extract extra attributes (email, name, department, etc.)
    const rawAttrs = authSuccess?.attributes || {};
    const attributes: Record<string, string> = {};

    for (const [key, val] of Object.entries(rawAttrs)) {
      if (typeof val === 'string') {
        attributes[key] = val;
      } else if (Array.isArray(val)) {
        attributes[key] = val[0] ?? '';
      } else if (typeof val === 'object' && val !== null) {
        attributes[key] = (val as any)._ ?? (val as any)['#text'] ?? JSON.stringify(val);
      }
    }

    console.log(JSON.stringify({
      level: 'INFO',
      message: 'CAS: authentication success',
      username,
      attributes,
    }));

    return { success: true, username, attributes };
  }

  return {
    success: false,
    errorCode: 'CAS_UNKNOWN_RESPONSE',
    errorMessage: 'Unrecognised response from CAS server.',
  };
}