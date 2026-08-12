import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PVCFC_DEMO_SCENARIOS,
  PVCFC_SUGGESTION_PILLS,
} from "./demoScenarios.js";

const REQUIRED_PROVIDER_SCENARIOS = [
  "exact-product",
  "product-comparison",
  "certificate-traceability",
  "dealer-contact-freshness",
  "urban-agriculture",
  "corporate-facilities",
  "public-reports",
] as const;

const REQUIRED_LIVE_SCENARIOS = [
  "current-official-news",
  "current-official-catalogue",
] as const;

describe("PVCFC evidence-backed demo content", () => {
  it("maps the provider-backed demos to the real fixture collections", () => {
    const modesById = Object.fromEntries(
      PVCFC_DEMO_SCENARIOS.map(({ id, evidenceMode }) => [id, evidenceMode]),
    );

    expect(modesById).toMatchObject(
      Object.fromEntries(
        REQUIRED_PROVIDER_SCENARIOS.map((id) => [id, "provider"]),
      ),
    );
    expect(modesById).toMatchObject(
      Object.fromEntries(
        REQUIRED_LIVE_SCENARIOS.map((id) => [id, "provider_then_live_web"]),
      ),
    );
  });

  it("keeps current-web evidence limited to news and the official catalogue", () => {
    expect(
      PVCFC_DEMO_SCENARIOS.filter(
        ({ evidenceMode }) => evidenceMode === "provider_then_live_web",
      ).map(({ id }) => id),
    ).toEqual(REQUIRED_LIVE_SCENARIOS);
  });

  it("names the hand-checked provider inventory behind each fixture demo", () => {
    const promptsById = Object.fromEntries(
      PVCFC_DEMO_SCENARIOS.map(({ id, turns }) => [id, turns.join(" ")]),
    );

    expect(promptsById["exact-product"]).toContain("67 hồ sơ sản phẩm");
    expect(promptsById["product-comparison"]).toContain("67 hồ sơ sản phẩm");
    expect(promptsById["certificate-traceability"]).toContain("249 hồ sơ");
    expect(promptsById["dealer-contact-freshness"]).toContain("18 hồ sơ");
    expect(promptsById["urban-agriculture"]).toContain("15 hồ sơ");
    expect(promptsById["corporate-facilities"]).toContain("7 hồ sơ");
    expect(promptsById["public-reports"]).toContain("3 báo cáo");
  });

  it("targets a dealer location that exists in the generated provider", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../services/kfc-agent-backend/fixtures/generated/pvcfc-public-data.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      collections: Array<{
        name: string;
        records: Array<{ id: string; name: string; address?: string }>;
      }>;
    };
    const dealer = fixture.collections
      .find(({ name }) => name === "dealers_contacts")
      ?.records.find(({ id }) => id === "dealer-khanh-my-ca-mau");
    const prompt = PVCFC_DEMO_SCENARIOS.find(
      ({ id }) => id === "dealer-contact-freshness",
    )?.turns.join(" ");

    expect(dealer).toMatchObject({
      name: "Cửa hàng phân bón Khánh My",
      address: "Xã Hòa Bình, Tỉnh Cà Mau",
    });
    expect(prompt).toContain("Cửa hàng phân bón Khánh My");
    expect(prompt).toContain("Xã Hòa Bình, Tỉnh Cà Mau");
  });

  it("keeps IDs unique, titles concise, and every replay turn usable", () => {
    const ids = PVCFC_DEMO_SCENARIOS.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(PVCFC_DEMO_SCENARIOS.every(({ title }) => title.length <= 48)).toBe(
      true,
    );
    expect(
      PVCFC_DEMO_SCENARIOS.every(
        ({ turns }) =>
          turns.length > 0 && turns.every((turn) => turn.trim().length > 0),
      ),
    ).toBe(true);
  });

  it("asks for official citations and makes optional live-web use visible", () => {
    for (const scenario of PVCFC_DEMO_SCENARIOS) {
      expect(scenario.turns.join(" ").toLowerCase()).toMatch(
        /dẫn nguồn|trích dẫn|url nguồn/,
      );
      if (scenario.evidenceMode === "provider_then_live_web") {
        expect(scenario.turns.join(" ").toLowerCase()).toContain(
          "cần tinyfish",
        );
      }
    }

    for (const pill of PVCFC_SUGGESTION_PILLS) {
      expect(pill.toLowerCase()).toMatch(/dẫn nguồn|trích dẫn|url nguồn/);
    }

    expect(
      PVCFC_SUGGESTION_PILLS.filter((pill) =>
        pill.toLowerCase().includes("web trực tiếp"),
      ),
    ).toHaveLength(2);
  });

  it("does not promise unsupported PVCFC actions or unverifiable live facts", () => {
    const executablePrompts = [
      ...PVCFC_SUGGESTION_PILLS,
      ...PVCFC_DEMO_SCENARIOS.flatMap(({ turns }) => turns),
    ].join("\n");

    expect(executablePrompts).not.toMatch(
      /giá trực tiếp|giá hiện tại|tồn kho hiện tại|giờ mở cửa đã xác nhận|đã đặt lịch kỹ sư|tự động nhắc|tự chẩn đoán|đặt mua|mua hàng|xuất pdf|chia sẻ (?:qua )?zalo|truy cập (?:hệ thống )?(?:nội bộ|đại lý)/i,
    );
  });
});
