import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from './password-hashing';

describe('password hashing', () => {
  it('uses the same Argon2id work factors for real and dummy hashes', async () => {
    const passwordHash = await hashPassword('a-long-test-password');
    const workFactors = 'm=19456,p=1,t=2';

    expect(passwordHash).toContain(`$argon2id$v=19$${workFactors}$`);
    expect(DUMMY_PASSWORD_HASH).toContain(`$argon2id$v=19$${workFactors}$`);
    await expect(
      verifyPassword(passwordHash, 'a-long-test-password'),
    ).resolves.toBe(true);
  });
});
