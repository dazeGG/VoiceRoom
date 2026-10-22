/** What a person is called on screen: their display name, or their login when none is set. */
export function displayNameOf(user: { displayName?: string | null | undefined; login: string }): string {
  return user.displayName?.trim() || user.login;
}
