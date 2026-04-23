// js/pass-trust.js — Device trust check (localStorage flag)
// See BUILD.md Step 3 for full contract.
// This is NOT auth. It is a convenience gate so students don't stumble
// into the staff surface. The PIN is not a secret.

export const PIN_VALUE = 'md1950';
export const PIN_LENGTH = 6;

export function isTrusted() {
  return localStorage.getItem('trusted_device') === 'true';
}

export function trustDevice() {
  localStorage.setItem('trusted_device', 'true');
}
