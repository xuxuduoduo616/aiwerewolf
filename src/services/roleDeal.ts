/**
 * Unbiased Fisher–Yates shuffle for dealing roles to seats.
 * `[...roles].sort(() => Math.random() - 0.5)` is not uniform: the result
 * depends on the sort algorithm and measurably favours some seats.
 */
export const shuffleRoles = <T,>(roles: readonly T[], random: () => number = Math.random): T[] => {
  const shuffled = [...roles];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};
