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
        secure: true,
        httpOnly: true,
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
        // domain: process.env.NODE_ENV === 'development' ? undefined : '.ngrok-free.app'
    }
};