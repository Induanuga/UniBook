import { pool } from '../db';
import { v4 as uuidv4 } from 'uuid';

export async function getUserByEmail(email: string) {
  const res = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase()]
  );
  return res.rows[0] || null;
}

export async function getUserById(id: string) {
  const res = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return res.rows[0] || null;
}

export async function createUser(data: {
  email: string;
  name: string;
  role: string;
  department?: string;
  passwordHash: string;
}) {
  const id = uuidv4();

  const res = await pool.query(
    `INSERT INTO users 
     (id, email, name, role, department, password_hash) 
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      id,
      data.email.toLowerCase(),
      data.name,
      data.role,
      data.department || null,
      data.passwordHash,
    ]
  );

  return res.rows[0];
}