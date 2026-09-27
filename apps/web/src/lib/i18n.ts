/**
 * UI strings live in catalogs, not in components (spec §54). One locale for now; the
 * lookup shape stays the same when an i18n library and more locales are added.
 */
const en = {
  'app.name': 'Hotel Platform',
  'login.title': 'Sign in',
  'login.subtitle': 'Use your staff account.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.submitting': 'Signing in…',
  'login.invalid': 'Invalid email or password.',
  'login.rateLimited': 'Too many attempts. Wait a few minutes and try again.',
  'org.select.title': 'Choose an organization',
  'org.select.subtitle': 'Your account has access to more than one organization.',
  'nav.signOut': 'Sign out',
  'nav.switchOrganization': 'Switch organization',
  'dashboard.properties': 'Properties',
  'dashboard.propertiesDescription': 'Properties you are authorized to see.',
  'dashboard.empty': 'You do not have access to any property yet.',
  'dashboard.access': 'Your access',
  'property.businessDate': 'Business date',
  'property.timezone': 'Time zone',
  'property.currency': 'Currency',
  'scope.organization': 'All properties',
  'error.generic': 'Something went wrong. Please try again.',
  loading: 'Loading…',
} as const;

export type MessageKey = keyof typeof en;

export function t(key: MessageKey): string {
  return en[key];
}
