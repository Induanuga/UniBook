// src/routes/casRoutes.ts
import { Router } from 'express';
import { casLogin, casCallback, casLogout } from '../controllers/casController';

const router = Router();

// GET /auth/cas/login    — redirect browser to CAS login page
router.get('/login', casLogin);

// GET /auth/cas/callback — CAS posts back here with ?ticket=ST-xxx
router.get('/callback', casCallback);

// GET /auth/cas/logout   — redirect browser to CAS logout page
//                          (kills the CAS server-side session)
router.get('/logout', casLogout);

export default router;
