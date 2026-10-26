import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from '@/lib/mongodb';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: string;
      accountStatus: string;
      mfaVerified?: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    role?: string;
    accountStatus?: string;
    mfaVerified?: boolean;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(clientPromise, {
    collections: {
      Users: 'users',
      Accounts: 'accounts',
      Sessions: 'sessions',
      VerificationTokens: 'verificationtokens',
    },
  }),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/super-admin/login',
    error: '/super-admin/login',
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      name: 'CampusCare Admin Credentials',
      credentials: {
        email: { label: 'University Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        mfaCode: { label: 'MFA Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        try {
          const apiOrigin = (process.env.API_ORIGIN || 'http://localhost:4000').replace(/\/+$/, '');
          const res = await fetch(`${apiOrigin}/api/v1/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-campuscare-client': 'web',
            },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
              mfaCode: credentials.mfaCode || undefined,
            }),
          });
          const json = await res.json();
          if (!res.ok || !json.data?.user) return null;
          const user = json.data.user;
          if (user.role !== 'super_admin' || user.accountStatus !== 'active') {
            return null;
          }
          return {
            id: user.id,
            name: user.fullName,
            email: user.email,
            role: user.role,
            accountStatus: user.accountStatus,
            mfaVerified: !json.data.mfaRequired,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        try {
          const client = await clientPromise;
          const db = client.db();
          const dbUser = await db.collection('users').findOne({ email: user.email?.toLowerCase().trim() });
          if (!dbUser || dbUser.role !== 'super_admin' || dbUser.accountStatus !== 'active') {
            return false;
          }
        } catch {
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? 'super_admin';
        token.accountStatus = user.accountStatus ?? 'active';
        token.mfaVerified = user.mfaVerified ?? true;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = (token.id as string) || token.sub || '';
        session.user.role = (token.role as string) || 'super_admin';
        session.user.accountStatus = (token.accountStatus as string) || 'active';
        session.user.mfaVerified = Boolean(token.mfaVerified);
      }
      return session;
    },
  },
});
