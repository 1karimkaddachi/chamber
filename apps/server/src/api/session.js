import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import config from '../config.js';

const PgStore = connectPgSimple(session);

export function createSessionLayer() {
  const store = new PgStore({
    conObject: { connectionString: config.databaseUrl },
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60,
  });
  const middleware = session({
    store,
    name: config.session.name,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.session.cookieSecure,
      maxAge: config.session.maxAgeDays * 86400000,
      path: '/',
    },
  });
  return { store, middleware };
}

export default createSessionLayer;
