# Locator Resolver Usage Examples

This document provides examples of how to use different locator types in your JSON locator files.

## Locator Type Priority (Best Practices)

1. **`getByRole`** - Best for accessibility, semantic HTML
2. **`getByLabel`** - Best for form fields
3. **`getByText`** - Good for buttons, links, visible text
4. **`getByPlaceholder`** - For input fields with placeholders
5. **`locator`** - CSS/XPath fallback (use sparingly, prefer by ID when available)

## Examples by Element Type

### Buttons

```json
{
  "submitButton": {
    "by": "getByRole",
    "value": {
      "role": "button",
      "name": "Submit"
    }
  },
  "submitButtonById": {
    "by": "locator",
    "value": "#submit-button"
  },
  "submitButtonByText": {
    "by": "getByText",
    "value": "Submit"
  },
  "submitButtonExact": {
    "by": "getByText",
    "value": {
      "text": "Submit Form",
      "exact": true
    }
  }
}
```

### Form Fields (Inputs, Textareas)

```json
{
  "emailInput": {
    "by": "getByLabel",
    "value": "Email address"
  },
  "emailInputExact": {
    "by": "getByLabel",
    "value": {
      "text": "Email",
      "exact": true
    }
  },
  "passwordInput": {
    "by": "getByPlaceholder",
    "value": "Enter your password"
  },
  "usernameInput": {
    "by": "locator",
    "value": "#username"
  },
  "searchInput": {
    "by": "getByRole",
    "value": {
      "role": "searchbox",
      "name": "Search"
    }
  }
}
```

### Dropdowns/Selects

```json
{
  "countryDropdown": {
    "by": "getByRole",
    "value": {
      "role": "combobox",
      "name": "Country"
    }
  },
  "languageSelect": {
    "by": "getByLabel",
    "value": "Language"
  },
  "statusDropdown": {
    "by": "locator",
    "value": "#status-select"
  }
}
```

### Links

```json
{
  "homeLink": {
    "by": "getByRole",
    "value": {
      "role": "link",
      "name": "Home"
    }
  },
  "forgotPasswordLink": {
    "by": "getByText",
    "value": "Forgot password?"
  },
  "signUpLink": {
    "by": "locator",
    "value": "#signup-link"
  }
}
```

### Checkboxes and Radio Buttons

```json
{
  "agreeCheckbox": {
    "by": "getByRole",
    "value": {
      "role": "checkbox",
      "name": "I agree to terms"
    }
  },
  "newsletterCheckbox": {
    "by": "getByLabel",
    "value": "Subscribe to newsletter"
  },
  "maleRadio": {
    "by": "getByRole",
    "value": {
      "role": "radio",
      "name": "Male"
    }
  }
}
```

### Images and Media

```json
{
  "logoImage": {
    "by": "getByAltText",
    "value": "Company Logo"
  },
  "profilePicture": {
    "by": "getByAltText",
    "value": {
      "text": "User profile",
      "exact": false
    }
  }
}
```

### Drag and Drop Elements

```json
{
  "draggableItem": {
    "by": "locator",
    "value": "#draggable-item-1"
  },
  "dropZone": {
    "by": "locator",
    "value": "#drop-zone"
  },
  "sortableList": {
    "by": "getByRole",
    "value": {
      "role": "list",
      "name": "Sortable items"
    }
  }
}
```

### Tables and Lists

```json
{
  "dataTable": {
    "by": "getByRole",
    "value": {
      "role": "table",
      "name": "User data"
    }
  },
  "firstRow": {
    "by": "getByRole",
    "value": {
      "role": "row",
      "name": "Row 1"
    }
  },
  "itemList": {
    "by": "getByRole",
    "value": {
      "role": "list"
    }
  }
}
```

### Modals and Dialogs

```json
{
  "confirmDialog": {
    "by": "getByRole",
    "value": {
      "role": "dialog",
      "name": "Confirm action"
    }
  },
  "modalCloseButton": {
    "by": "getByRole",
    "value": {
      "role": "button",
      "name": "Close"
    }
  }
}
```

### Iframes (Special Case)

```json
{
  "iframeContent": {
    "by": "frameLocator",
    "value": "iframe[name='content']"
  }
}
```

**Note:** For iframes, you'll need to handle them differently in your PageObject:

```typescript
// In your PageObject
const frame = this.page.frameLocator('iframe[name="content"]');
const button = frame.getByRole('button', { name: 'Submit' });
```

### Complex Selectors (Fallback)

```json
{
  "complexSelector": {
    "by": "locator",
    "value": ".container > .item:first-child"
  },
  "xpathSelector": {
    "by": "locator",
    "value": "xpath=//div[@class='item']"
  }
}
```

## Complete Example: Login Form

```json
{
  "url": "https://example.com/login",
  "selectors": {
    "usernameInput": {
      "by": "getByLabel",
      "value": "Username"
    },
    "passwordInput": {
      "by": "getByPlaceholder",
      "value": "Enter password"
    },
    "loginButton": {
      "by": "getByRole",
      "value": {
        "role": "button",
        "name": "Sign in"
      }
    },
    "rememberMeCheckbox": {
      "by": "getByLabel",
      "value": "Remember me"
    },
    "forgotPasswordLink": {
      "by": "getByText",
      "value": "Forgot password?"
    },
    "errorMessage": {
      "by": "locator",
      "value": "#login-error"
    }
  }
}
```

## Tips

1. **Prefer semantic locators**: Use `getByRole`, `getByLabel`, `getByText` over CSS selectors
2. **Use `exact: true`** when you need precise text matching
3. **Use element IDs when available**: For elements with stable IDs, use `locator` with `#id` selector
4. **Chain locators** in your PageObject methods when needed:
   ```typescript
   const container = this.getLocator('tableContainer');
   const row = container.locator('tr').first();
   ```
5. **Avoid brittle selectors**: Don't use CSS classes that change with styling updates
6. **Fallback to locator**: When semantic locators don't work, use `locator` with CSS selectors or element IDs

