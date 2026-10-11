/** The account shape both sign-in flows produce (PWA: Google Identity Services; Android: Firebase). */
export interface CloudAccount {
  email: string;
  /** Google account id (`sub`) — the Drive folder key, identical across phone and browser. */
  subject: string;
  accessToken(): Promise<string>;
}
