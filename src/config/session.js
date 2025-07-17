//src/config/session.js
import dotenv from 'dotenv';
dotenv.config();

export const sessionConfig = {
    name: 'sessionId',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    secret: process.env.SESSION_SECRET,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
        domain: undefined
    }
};