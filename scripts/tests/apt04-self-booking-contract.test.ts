import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("self booking page enforces terms acceptance", () => {
  const source = read("src/app/[studioSlug]/appointments/page.tsx");
  assert.equal(source.includes("terms_accepted"), true);
  assert.equal(source.includes("terms_required"), true);
  assert.equal(source.includes("createSelfAppointment"), true);
});

test("self appointment service uses customer actor", () => {
  const source = read("src/lib/salon-appointments-self.ts");
  assert.equal(source.includes("p_actor_role: \"customer\""), true);
  assert.equal(source.includes("resolveSelfSalonCustomer"), true);
  assert.equal(source.includes("salon_customer_id"), true);
});

test("member nav exposes my appointments", () => {
  const nav = read("src/components/SiteHeaderClientNav.tsx");
  const accountMenu = read("src/components/StudioAccountEntry.tsx");
  const tabs = read("src/components/StudioMemberTabs.tsx");
  assert.equal(nav.includes("My appointments"), true);
  assert.equal(accountMenu.includes("My appointments"), true);
  assert.equal(tabs.includes("Appointments"), true);
});
