import { randomBytes } from 'node:crypto';
import { DEMO_USER, DEMO_USERS } from '@revo/db/fixtures';

type DemoUser = (typeof DEMO_USERS)[number];

/** In-memory OAuth state: codes and tokens map to demo users. */
export class MockState {
  private codes = new Map<string, DemoUser>();
  private tokens = new Map<string, DemoUser>();
  private refreshTokens = new Map<string, DemoUser>();
  /** Login used by the next /login/oauth/authorize (changed with POST /__mock/user). */
  nextLogin: string = DEMO_USER.login;

  constructor(readonly baseUrl: string) {}

  userByLogin(login: string): DemoUser | undefined {
    return DEMO_USERS.find((u) => u.login === login);
  }

  issueCode(): string {
    const user = this.userByLogin(this.nextLogin) ?? DEMO_USER;
    const code = randomBytes(12).toString('hex');
    this.codes.set(code, user);
    return code;
  }

  exchangeCode(code: string) {
    const user = this.codes.get(code);
    if (!user) return null;
    this.codes.delete(code);
    return this.issueTokens(user);
  }

  refresh(refreshToken: string) {
    const user = this.refreshTokens.get(refreshToken);
    if (!user) return null;
    this.refreshTokens.delete(refreshToken);
    return this.issueTokens(user);
  }

  userForToken(token: string | null): DemoUser | null {
    return token ? (this.tokens.get(token) ?? null) : null;
  }

  private issueTokens(user: DemoUser) {
    const access = `ghu_mock_${randomBytes(16).toString('hex')}`;
    const refresh = `ghr_mock_${randomBytes(16).toString('hex')}`;
    this.tokens.set(access, user);
    this.refreshTokens.set(refresh, user);
    return {
      access_token: access,
      token_type: 'bearer',
      scope: '',
      expires_in: 28_800,
      refresh_token: refresh,
      refresh_token_expires_in: 15_811_200,
    };
  }
}
