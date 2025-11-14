import { Page, Locator } from '@playwright/test';

export type LocatorDescriptor =
  // Role-based (recommended for accessibility)
  | { by: 'getByRole'; value: { role: Parameters<Page['getByRole']>[0]; name?: string | RegExp; options?: Omit<Parameters<Page['getByRole']>[1], 'name'> } }
  // Label-based (for form fields)
  | { by: 'getByLabel'; value: string | { text: string; exact?: boolean } }
  // Text-based (for buttons, links, text content)
  | { by: 'getByText'; value: string | RegExp | { text: string | RegExp; exact?: boolean } }
  // Placeholder (for input fields)
  | { by: 'getByPlaceholder'; value: string | RegExp | { text: string | RegExp; exact?: boolean } }
  // Title attribute
  | { by: 'getByTitle'; value: string | RegExp | { text: string | RegExp; exact?: boolean } }
  // Alt text (for images)
  | { by: 'getByAltText'; value: string | RegExp | { text: string | RegExp; exact?: boolean } }
  // Test ID (data-testid attribute)
  | { by: 'getByTestId'; value: string }
  // Generic locator (CSS selector, XPath, etc.) - use as fallback
  | { by: 'locator'; value: Parameters<Page['locator']>[0] }
  // Frame locator (for iframes)
  | { by: 'frameLocator'; value: Parameters<Page['frameLocator']>[0] };

export type LocatorMap = Record<string, LocatorDescriptor>;

/**
 * Resolves a LocatorDescriptor to a Playwright Locator
 * @param page - Playwright Page object
 * @param descriptor - LocatorDescriptor with 'by' and 'value' properties
 * @returns Playwright Locator
 * 
 * @example
 * // Role-based (recommended)
 * { by: 'getByRole', value: { role: 'button', name: 'Submit' } }
 * 
 * @example
 * // Text-based
 * { by: 'getByText', value: 'Click here' }
 * 
 * @example
 * // Placeholder
 * { by: 'getByPlaceholder', value: 'Enter email' }
 * 
 * @example
 * // CSS selector (fallback)
 * { by: 'locator', value: '#submit-btn' }
 * 
 * @example
 * // Test ID
 * { by: 'getByTestId', value: 'nav-item-realms' }
 */
export function resolveLocator(page: Page, descriptor: LocatorDescriptor): Locator {
  switch (descriptor.by) {
    case 'getByRole': {
      const { role, name, options } = descriptor.value;
      return page.getByRole(role, { name, ...options });
    }

    case 'getByLabel': {
      if (typeof descriptor.value === 'string') {
        return page.getByLabel(descriptor.value, { exact: false });
      }
      const { text, exact = false } = descriptor.value;
      return page.getByLabel(text, { exact });
    }

    case 'getByText': {
      if (typeof descriptor.value === 'string' || descriptor.value instanceof RegExp) {
        return page.getByText(descriptor.value, { exact: false });
      }
      const { text, exact = false } = descriptor.value;
      return page.getByText(text, { exact });
    }

    case 'getByPlaceholder': {
      if (typeof descriptor.value === 'string' || descriptor.value instanceof RegExp) {
        return page.getByPlaceholder(descriptor.value, { exact: false });
      }
      const { text, exact = false } = descriptor.value;
      return page.getByPlaceholder(text, { exact });
    }

    case 'getByTitle': {
      if (typeof descriptor.value === 'string' || descriptor.value instanceof RegExp) {
        return page.getByTitle(descriptor.value, { exact: false });
      }
      const { text, exact = false } = descriptor.value;
      return page.getByTitle(text, { exact });
    }

    case 'getByAltText': {
      if (typeof descriptor.value === 'string' || descriptor.value instanceof RegExp) {
        return page.getByAltText(descriptor.value, { exact: false });
      }
      const { text, exact = false } = descriptor.value;
      return page.getByAltText(text, { exact });
    }

    case 'getByTestId': {
      return page.getByTestId(descriptor.value);
    }

    case 'locator': {
      return page.locator(descriptor.value);
    }

    case 'frameLocator': {
      // Note: frameLocator returns a FrameLocator, not a Locator
      // This is a special case - you may need to handle it differently
      // For now, we'll return it as Locator (TypeScript will handle the type)
      return page.frameLocator(descriptor.value) as unknown as Locator;
    }

    default:
      throw new Error(`Unsupported locator descriptor: ${JSON.stringify(descriptor)}`);
  }
}

