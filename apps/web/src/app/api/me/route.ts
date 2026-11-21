import { route } from '~/server/http/route';

/** The signed-in user. */
export const GET = route({}, ({ user }) => user);
