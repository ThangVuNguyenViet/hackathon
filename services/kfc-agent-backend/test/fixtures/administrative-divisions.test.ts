import { describe, expect, it } from 'vitest';
import { loadBundledGeneratedFixtures } from '../../src/fixtures/bundledFixtures.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';

describe('Vietnam administrative fixtures', () => {
  it('loads the complete catalog through the bundled Worker fixture path', () => {
    const fixtures = loadBundledGeneratedFixtures();

    expect(fixtures.administrativeDivisions.provinces).toHaveLength(34);
    expect(fixtures.administrativeDivisions.communes).toHaveLength(3_321);
    expect(fixtures.administrativeLegacyMappings).toHaveLength(2);
  });

  it('loads the complete official two-tier catalog effective 1 July 2025', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());

    expect(fixtures.administrativeDivisions).toMatchObject({
      effectiveFrom: '2025-07-01',
      authority: {
        documentId: '19/2025/QĐ-TTg',
        decisionUrl:
          'https://www.nso.gov.vn/default/2025/07/quyet-dinh-ban-hanh-bang-danh-muc-va-ma-so-cac-don-vi-hanh-chinh-viet-nam/',
      },
      extraction: {
        revision: 'v3.0.2',
        license: 'MIT',
        copyright: 'Copyright (c) 2021 Thang Le Quoc',
      },
    });
    expect(fixtures.administrativeDivisions.provinces).toHaveLength(34);
    expect(fixtures.administrativeDivisions.communes).toHaveLength(3_321);
    expect(
      new Set(
        fixtures.administrativeDivisions.communes.map(
          (commune) => commune.code,
        ),
      ),
    ).toHaveLength(3_321);
    expect(
      fixtures.administrativeDivisions.communes.every((commune) =>
        fixtures.administrativeDivisions.provinces.some(
          (province) => province.code === commune.provinceCode,
        ),
      ),
    ).toBe(true);
  });

  it('keeps current administrative validity separate from mock delivery coverage', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());

    expect(fixtures.administrativeDivisions.communes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '27004',
          fullName: 'Phường Tân Bình',
          provinceCode: '79',
        }),
      ]),
    );
    expect(fixtures.administrativeLegacyMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legacyProvince: 'Thành phố Hồ Chí Minh',
          legacyDistrict: 'Quận Tân Bình',
          legacyCommune: 'Phường 14',
          canonicalProvinceCode: '79',
          canonicalCommuneCode: '27004',
        }),
      ]),
    );
    expect(fixtures.fulfillmentServiceAreas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalCommune: 'Phường Tân Bình',
          canonicalProvince: 'Thành phố Hồ Chí Minh',
          communes: expect.arrayContaining(['Phường Tân Bình']),
          provinces: expect.arrayContaining([
            'Thành phố Hồ Chí Minh',
            'TP.HCM',
          ]),
        }),
      ]),
    );
    expect(fixtures.administrativeDivisions.communes.length).toBeGreaterThan(
      fixtures.fulfillmentServiceAreas.length,
    );
  });
});
