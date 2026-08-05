import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "../../..");

describe("qualified release image assembly", () => {
  it("requires explicit QMB and catalog build contexts with no production fallback", () => {
    const main = readFileSync(resolve(repository, "services/kfc-agent-backend/Dockerfile"), "utf8");
    const scorer = readFileSync(resolve(repository, "services/kfc-recommendation-scorer/Dockerfile"), "utf8");
    const build = readFileSync(resolve(repository, "infra/kfc-recommendation-aws/bin/build-release-images.sh"), "utf8");
    expect(main).toContain("COPY --from=qualified_bundle / /opt/kfc/bundle/");
    expect(main).toContain("COPY --from=trusted_catalog /catalog.json /opt/kfc/catalog/catalog.json");
    expect(main).toContain("sha256sum -c");
    expect(scorer).toContain("COPY --from=qualified_bundle / /opt/kfc/bundle/");
    expect(build).toContain("${QUALIFIED_BUNDLE_ROOT:?required}");
    expect(build).toContain("--build-context \"qualified_bundle=$QUALIFIED_BUNDLE_ROOT\"");
    expect(build).toContain("--build-context \"trusted_catalog=$catalog_context\"");
  });
});
