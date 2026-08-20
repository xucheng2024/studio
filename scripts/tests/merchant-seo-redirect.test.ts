import assert from "node:assert/strict";
import test from "node:test";
import {
  customDomainHostCandidates,
  getCustomDomainHostAlias,
  isCustomDomainHostMatch,
} from "../../src/lib/customDomain.ts";
import {
  getMerchantSeoRedirect,
  merchantSitemapListPaths,
  stripStudioPrefixFromPath,
  type MerchantSeoStudio,
} from "../../src/lib/merchantSeo.ts";

const platformHost = "www.sgmystudio.com";
const studio: MerchantSeoStudio = {
  publicSlug: "lotus",
  customDomain: "lotus.example",
  customDomainStatus: "active",
};
const apexStudio: MerchantSeoStudio = {
  publicSlug: "lotus",
  customDomain: "lotus.com",
  customDomainStatus: "active",
};

test("pairs apex with www only", () => {
  assert.equal(getCustomDomainHostAlias("lotus.com"), "www.lotus.com");
  assert.equal(getCustomDomainHostAlias("www.lotus.com"), "lotus.com");
  assert.equal(getCustomDomainHostAlias("book.lotus.com"), null);
  assert.deepEqual(customDomainHostCandidates("lotus.com"), ["lotus.com", "www.lotus.com"]);
  assert.deepEqual(customDomainHostCandidates("book.lotus.com"), ["book.lotus.com"]);
  assert.equal(isCustomDomainHostMatch("www.lotus.com", "lotus.com"), true);
  assert.equal(isCustomDomainHostMatch("book.lotus.com", "www.book.lotus.com"), false);
});

test("strips the studio prefix used on platform URLs", () => {
  assert.equal(stripStudioPrefixFromPath("/lotus", "lotus"), "/");
  assert.equal(stripStudioPrefixFromPath("/lotus/services/facial", "lotus"), "/services/facial");
  assert.equal(stripStudioPrefixFromPath("/services", "lotus"), "/services");
});

test("301 www to the saved apex host and strips /slug on the custom domain", () => {
  assert.equal(
    getMerchantSeoRedirect({
      incomingHost: "www.lotus.com",
      platformHost,
      pathname: "/lotus/services",
      search: "",
      customDomainStudio: apexStudio,
      platformPathStudio: null,
    }),
    "https://lotus.com/services",
  );
  assert.equal(
    getMerchantSeoRedirect({
      incomingHost: "lotus.com",
      platformHost,
      pathname: "/lotus/classes/flow",
      search: "?x=1",
      customDomainStudio: apexStudio,
      platformPathStudio: null,
    }),
    "https://lotus.com/classes/flow?x=1",
  );
});

test("301 platform slug URLs only when the custom domain is active", () => {
  assert.equal(
    getMerchantSeoRedirect({
      incomingHost: platformHost,
      platformHost,
      pathname: "/lotus/shop/oil",
      search: "",
      customDomainStudio: null,
      platformPathStudio: studio,
    }),
    "https://lotus.example/shop/oil",
  );
  assert.equal(
    getMerchantSeoRedirect({
      incomingHost: platformHost,
      platformHost,
      pathname: "/lotus",
      search: "",
      customDomainStudio: null,
      platformPathStudio: { ...studio, customDomainStatus: "pending" },
    }),
    null,
  );
});

test("does not redirect merchants without a custom domain", () => {
  assert.equal(
    getMerchantSeoRedirect({
      incomingHost: platformHost,
      platformHost,
      pathname: "/lotus/services",
      search: "",
      customDomainStudio: null,
      platformPathStudio: null,
    }),
    null,
  );
  assert.equal(
    getMerchantSeoRedirect({
      incomingHost: platformHost,
      platformHost,
      pathname: "/dashboard",
      search: "",
      customDomainStudio: null,
      platformPathStudio: studio,
    }),
    null,
  );
});

test("skips auth and dashboard slug-strip on an already-canonical custom host", () => {
  assert.equal(
    getMerchantSeoRedirect({
      incomingHost: "lotus.com",
      platformHost,
      pathname: "/lotus/auth",
      search: "",
      customDomainStudio: apexStudio,
      platformPathStudio: null,
    }),
    null,
  );
});

test("custom-domain sitemap list paths drop the studio slug", () => {
  assert.deepEqual(
    merchantSitemapListPaths({
      studioSlug: "lotus",
      hasServices: true,
      hasShop: true,
    }),
    ["/services", "/shop"],
  );
  assert.deepEqual(merchantSitemapListPaths({ studioSlug: "lotus" }), []);
});
