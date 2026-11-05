import { describe, expect, it } from 'vitest';
import { customerDisplayName, customerDisplayPhone, isDeletedAccount } from './deletedAccount';

describe('deleted accounts', () => {
  it('recognises the del: placeholder phone', () => {
    expect(isDeletedAccount('del:c1a652b08066418')).toBe(true);
    expect(isDeletedAccount('+94771234567')).toBe(false);
    expect(isDeletedAccount(null)).toBe(false);
  });

  it('shows "Deleted account" and no code for a deleted customer', () => {
    expect(customerDisplayName({ full_name: null, phone: 'del:c1a652b08066418' })).toBe('Deleted account');
    expect(customerDisplayPhone('del:c1a652b08066418')).toBe('Number removed');
  });

  it('keeps names, the unnamed label and phones for everyone else', () => {
    expect(customerDisplayName({ full_name: 'Nasly', phone: '+94783937034' })).toBe('Nasly');
    expect(customerDisplayName({ full_name: null, phone: '+94783937034' })).toBe('Unnamed customer');
    expect(customerDisplayPhone('+94783937034')).toBe('+94783937034');
  });
});
