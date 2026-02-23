import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';
import passport from 'passport';
import MongoStore from 'connect-mongo';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
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
      cookie: { secure: process.env.NODE_ENV === 'production' },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
