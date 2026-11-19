import { describe, expect, it } from 'vitest';
import { escapeLike } from '../../src/services/user.service.js';
import { loginSchema, registerSchema } from '../../src/validators/auth.validators.js';
import {
  listUsersQuerySchema,
  searchUsersQuerySchema,
  updateProfileSchema,
  userIdParamSchema,
} from '../../src/validators/user.validators.js';

const valid = { email: 'Alice@Example.com ', username: ' Alice_01', displayName: '  Alice  ', password: 'long-enough-pw' };

describe('registerSchema', () => {
  it('normalises email and username and trims the display name', () => {
    expect(registerSchema.parse(valid)).toEqual({
      email: 'alice@example.com',
      username: 'alice_01',
      displayName: 'Alice',
      password: 'long-enough-pw',
    });
  });

  it('does not trim or alter the password', () => {
    expect(registerSchema.parse({ ...valid, password: '  spaced password  ' }).password).toBe('  spaced password  ');
  });

  it.each([
    ['email', 'not-an-email'],
    ['email', `${'a'.repeat(250)}@example.com`],
    ['username', 'ab'],
    ['username', 'has space'],
    ['username', 'dash-ed'],
    ['username', 'a'.repeat(25)],
    ['username', '<script>'],
    ['displayName', '   '],
    ['displayName', 'x'.repeat(51)],
    ['password', 'short'],
    ['password', 'x'.repeat(129)],
  ])('rejects invalid %s: %s', (field, value) => {
    const result = registerSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });

  it('rejects missing fields and non-string types', () => {
    expect(registerSchema.safeParse({}).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 1234567890 }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, email: { $ne: null } }).success).toBe(false);
  });

  it('drops unknown fields so they can never reach the database layer', () => {
    const parsed = registerSchema.parse({ ...valid, role: 'ADMIN', passwordHash: 'x' });
    expect(parsed).not.toHaveProperty('role');
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});

describe('loginSchema', () => {
  it('lower-cases the identifier', () => {
    expect(loginSchema.parse({ identifier: ' ALICE ', password: 'x' }).identifier).toBe('alice');
  });
  it('requires both fields', () => {
    expect(loginSchema.safeParse({ identifier: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: 'alice', password: '' }).success).toBe(false);
  });
});

describe('user validators', () => {
  it('applies defaults and bounds to list queries', () => {
    expect(listUsersQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(listUsersQuerySchema.parse({ limit: '5' }).limit).toBe(5);
    expect(listUsersQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('requires at least two characters to search', () => {
    expect(searchUsersQuerySchema.safeParse({ q: ' a ' }).success).toBe(false);
    expect(searchUsersQuerySchema.parse({ q: ' al ' })).toEqual({ q: 'al', limit: 20 });
  });

  it('accepts only UUIDs as user ids', () => {
    expect(userIdParamSchema.safeParse({ id: '6f1c2a7e-3b1d-4a6f-9c1e-2d3f4a5b6c7d' }).success).toBe(true);
    expect(userIdParamSchema.safeParse({ id: '1 OR 1=1' }).success).toBe(false);
    expect(userIdParamSchema.safeParse({ id: '../etc/passwd' }).success).toBe(false);
  });

  it('rejects an empty profile update and accepts partial ones', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.parse({ bio: null })).toEqual({ bio: null });
    expect(updateProfileSchema.parse({ notificationPrefs: { sound: false } })).toEqual({
      notificationPrefs: { sound: false },
    });
    expect(updateProfileSchema.safeParse({ notificationPrefs: { sound: 'no' } }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(281) }).success).toBe(false);
  });
});

describe('escapeLike', () => {
  it('neutralises LIKE wildcards so they match literally', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike('plain')).toBe('plain');
  });
});
