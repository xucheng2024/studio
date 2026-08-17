import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReleaseStudioId,
  assertReleaseSupabaseUrl,
  assertVercelCandidateUrl,
  requiredEnvironment,
} from "../lib/release-gate-safety.mjs";

test("accepts exact hosted release targets", () => {
  assert.equal(assertReleaseSupabaseUrl("https://project-ref.supabase.co"), "https://project-ref.supabase.co");
  assert.equal(assertVercelCandidateUrl("https://studio-git-abc.vercel.app"), "https://studio-git-abc.vercel.app");
  assert.equal(assertReleaseStudioId("123e4567-e89b-12d3-a456-426614174000", "STUDIO_ID"), "123e4567-e89b-12d3-a456-426614174000");
});

test("rejects local, credentialed, and non-provider release targets", () => {
  for (const value of ["http://project.supabase.co", "https://127.0.0.1", "https://user:secret@project.supabase.co"]) {
    assert.throws(() => assertReleaseSupabaseUrl(value));
  }
  for (const value of ["http://studio.vercel.app", "https://example.com", "https://studio.vercel.app/path"]) {
    assert.throws(() => assertVercelCandidateUrl(value));
  }
});

test("requires explicit release environment values", () => {
  assert.equal(requiredEnvironment("VALUE", { VALUE: " present " }), "present");
  assert.throws(() => requiredEnvironment("VALUE", {}), /Missing required release environment/);
  assert.throws(() => assertReleaseStudioId("not-a-uuid", "STUDIO_ID"), /must be a UUID/);
});
