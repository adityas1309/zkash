import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import passport from 'passport';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  
  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  };

  // Use MongoDB session store in production
  if (process.env.NODE_ENV === 'production' && process.env.MONGODB_URI) {
    sessionConfig.store = MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      touchAfter: 24 * 3600, // lazy session update (seconds)
    });
  }

  app.use(session(sessionConfig));
  app.use(passport.initialize());
  app.use(passport.session());
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
