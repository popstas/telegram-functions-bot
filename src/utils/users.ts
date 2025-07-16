export function includesUser(
  list: readonly string[] | undefined,
  username: string | undefined,
): boolean {
  if (!username || !list) return false;
  const name = username.toLowerCase();
  return list.some((u) => u.toLowerCase() === name);
}
