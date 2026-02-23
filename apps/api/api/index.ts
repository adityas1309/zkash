import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import session from 'express-session';
import passport from 'passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import MongoStore from 'connect-mongo';

let cachedServer: any;

export default async function handler(req: any, res: any) {
    if (!cachedServer) {
        const app = await NestFactory.create<NestExpressApplication>(AppModule);

        // Required to trust the Vercel proxy so secure cookies work properly
        app.set('trust proxy', 1);

        app.enableCors({
            origin: process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === 'production' ? true : 'http://localhost:3000'),
            credentials: true,
        });

        app.use(
            session({
                secret: process.env.SESSION_SECRET ?? 'dev-secret-change-in-production',
                resave: false,
                saveUninitialized: false,
                store: MongoStore.create({
                    mongoUrl: process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/lop',
                }),
                cookie: {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
                },
            }),
        );
        app.use(passport.initialize());
        app.use(passport.session());

        await app.init();
        cachedServer = app.getHttpAdapter().getInstance();
    }

    return cachedServer(req, res);
}
