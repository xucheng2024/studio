// A platform template must not appear as a studio policy (see 3d6b362).
// This used to be a page.tsx calling notFound(), but any page under
// [studioSlug] is wrapped in a streaming Suspense boundary by the segment's
// loading.tsx, so the initial response always flushes with status 200 before
// notFound() can run — the rendered body was correctly hidden, but the HTTP
// status never became 404. A route handler responds outside that pipeline.
export function GET() {
  return new Response(null, { status: 404 });
}
