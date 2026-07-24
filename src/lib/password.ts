/**
 * Password rules and strength scoring.
 *
 * §6.1 requires strong-password validation with clear strength feedback. The
 * rules are deliberately explicit and shown to the user as a live checklist
 * rather than hidden behind a single meter: a bar that says "weak" without
 * saying why is a guessing game, and users respond by appending "123".
 *
 * Rule IDs match the translation keys under auth.password.rules, so adding a
 * rule means adding it here and in both message files — nothing else.
 */

export const PASSWORD_MIN_LENGTH = 8

export type PasswordRuleId = 'length' | 'uppercase' | 'lowercase' | 'number' | 'symbol'

export const PASSWORD_RULES: ReadonlyArray<{
  id: PasswordRuleId
  test: (value: string) => boolean
}> = [
  { id: 'length', test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { id: 'uppercase', test: (v) => /[A-Z]/.test(v) },
  { id: 'lowercase', test: (v) => /[a-z]/.test(v) },
  { id: 'number', test: (v) => /\d/.test(v) },
  { id: 'symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
]

export type PasswordStrength = 0 | 1 | 2 | 3 | 4 | 5

export const STRENGTH_LABEL_KEY: Record<PasswordStrength, string> = {
  0: 'veryWeak',
  1: 'veryWeak',
  2: 'weak',
  3: 'fair',
  4: 'strong',
  5: 'veryStrong',
}

export function evaluatePassword(value: string) {
  const passed = PASSWORD_RULES.filter((rule) => rule.test(value)).map((rule) => rule.id)
  // Plain reduce rather than Object.fromEntries: the latter is only iOS 12.2+,
  // and this runs on the signup/reset password field which must work on the
  // oldest handsets we support (browserslist floor is iOS 12.0).
  const results = PASSWORD_RULES.reduce(
    (acc, rule) => {
      acc[rule.id] = rule.test(value)
      return acc
    },
    {} as Record<PasswordRuleId, boolean>,
  )

  return {
    results,
    strength: passed.length as PasswordStrength,
    allPassed: passed.length === PASSWORD_RULES.length,
  }
}

/**
 * Server-side gate. The client checklist is guidance; this is the boundary.
 * A form can be bypassed, so nothing may rely on the browser having enforced
 * these (§2.4).
 */
export function isPasswordAcceptable(value: string) {
  return PASSWORD_RULES.every((rule) => rule.test(value))
}
