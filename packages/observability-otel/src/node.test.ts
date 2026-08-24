import { describe, expect, it } from 'vitest';

import { attributesCommon } from './node';

describe('node resource attributes', () => {
  it('keeps a unique service instance id stable for the process lifetime', () => {
    const firstAttributes = attributesCommon();
    const secondAttributes = attributesCommon();

    expect(firstAttributes['service.instance.id']).toMatch(
      /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/u,
    );
    expect(secondAttributes['service.instance.id']).toBe(firstAttributes['service.instance.id']);
  });
});
