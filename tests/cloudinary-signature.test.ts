import { describe, it, expect } from 'vitest'
import { buildStringToSign, signParams } from '../supabase/functions/sign-upload/signature'

// Cloudinary's documented worked example:
//   params  : public_id=sample_image, timestamp=1315060510,
//             eager=w_400,h_300,c_pad|w_260,h_200,c_crop
//   secret  : abcd
// https://cloudinary.com/documentation/signatures
const DOC_PARAMS = {
  public_id: 'sample_image',
  timestamp: '1315060510',
  eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
}
const DOC_STRING_TO_SIGN =
  'eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510'
const DOC_SIGNATURE = 'bfd09f95f331f558cbd1320e67aa8d488770583e'

describe('buildStringToSign', () => {
  // The fallible part: alphabetical sort, = between name and value, & between
  // pairs. Cloudinary publishes this exact string, so it's checkable.
  it('matches Cloudinary’s documented serialization', () => {
    expect(buildStringToSign(DOC_PARAMS)).toBe(DOC_STRING_TO_SIGN)
  })

  it('sorts alphabetically by parameter name regardless of insertion order', () => {
    expect(buildStringToSign({ timestamp: '2', folder: 'a', context: 'z' })).toBe(
      'context=z&folder=a&timestamp=2',
    )
  })

  // file, cloud_name, resource_type and api_key are sent in the upload but are
  // NEVER signed. Including one produces an invalid signature server-side —
  // a failure that surfaces only on a real upload, so pin it here.
  it('excludes the four never-signed params', () => {
    expect(
      buildStringToSign({
        timestamp: '1',
        folder: 'mandals/x',
        file: 'blob',
        cloud_name: 'demo',
        resource_type: 'image',
        api_key: '123',
      }),
    ).toBe('folder=mandals/x&timestamp=1')
  })
})

describe('signParams', () => {
  it('reproduces Cloudinary’s documented signature', async () => {
    expect(await signParams(DOC_PARAMS, 'abcd')).toBe(DOC_SIGNATURE)
  })

  it('changes when the secret changes', async () => {
    expect(await signParams(DOC_PARAMS, 'wrong-secret')).not.toBe(DOC_SIGNATURE)
  })
})
