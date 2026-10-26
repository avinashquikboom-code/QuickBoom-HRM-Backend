# Campaign module error investigation and repair

## Findings and limits of production verification

The exact reported production image URL was checked and returned HTTP 404. The public production health endpoint returned HTTP 200. No production SSH/log connection or authenticated production session was supplied; the original production 500/502 exception traces and the specific campaign ID returning “Campaign not found” could not be retrieved. Findings below distinguish observed repository/configuration defects from unverified production causes.

### Campaign not found

The schema uses a persisted string campaign ID (default UUID); it is not an employee or numeric invoice ID. The create response already includes `data.id`. The admin client did not validate that response, and the modal discarded the created ID when the subsequent send failed; retrying could create another campaign. It now validates/retains the persisted ID, encodes IDs in detail/update/send/schedule/analytics requests, locks duplicate submissions, and updates/retries the saved campaign rather than creating another. Missing literal `undefined`/`null` route IDs produce 400; genuine missing/inaccessible IDs produce 404.

ID-based reads and mutations previously lacked the actor's existing office/store/branch scope. They now use that scope for detail, update, send, schedule, cancel, delete, analytics and listing. Existing global/company-admin role behavior remains intact; no new tenant/company membership was invented from the unused Campaign.companyId field. The exact production failing request/ID still needs to be correlated with deployed logs.

### Campaign image 404

The legacy image `campaign_1793030810851_22178914.png` was absent from the configured local upload directory, and no S3 configuration was present in that local database/environment. Both checked-in Compose deployment paths originally lacked persistent upload volumes; replacing a container can therefore lose runtime uploads. This is a concrete durability defect, though production filesystem/object existence could not be inspected directly.

Image resolution previously could sign a guessed S3 key when neither local nor S3 existence had been confirmed. It also accepted inconsistent bare/relative/API-prefixed paths. Resolution now checks the actual local file or S3 object, normalizes legacy paths to the real `/api/uploads/campaigns/` route without duplicated API prefixes, preserves external/signed URL bytes, and returns `imageUrl: null, imageMissing: true` for missing legacy assets. Campaign metadata still renders. New assignments to missing managed files are rejected. The upload API returns only an actually stored image; the browser verifies and normalizes its returned URL.

The original missing image cannot be reconstructed by a route change. Restore its original object/file from backup or re-upload it. No substitute image or fabricated S3 object was created.

### Audience preview 502

`ALL_EMPLOYEES` is supported and the static preview route is registered ahead of campaign-ID routes. The original preview loaded the entire employee/token/device graph merely to produce counts and a 50-row sample, and the modal hid failures in the console while leaving stale counts visible. Counts now use employee-level database counts and a bounded 50-row sample. Missing tokens (or a missing optional user account) do not exclude an active employee from the in-app audience; inactive employee/user records are excluded according to the existing rules. Multiple tokens/devices do not multiply an employee count. Existing birthday filtering remains intact.

Invalid audiences, roles, IDs and timezones produce meaningful 400 responses. The modal displays preview failures, offers retry, clears stale results and ignores superseded responses when audience selection changes. Original production 502 attribution still requires the reverse-proxy/backend exception or OOM/restart logs; no claim is made that a timeout or memory failure was observed remotely.

### Upload 500 — confirmed configured-database dependency

The read-only readiness check found that the configured local database had Campaign, FCMToken and Device tables but lacked CampaignImageAsset, which every campaign upload accesses. Prisma migration status identified exactly one pending migration: `20261026120000_campaign_image_assets`. That existing additive migration is now applied in the configured local database; the final check confirms all four tables exist and migration deploy reports no pending migrations. No existing campaign, invoice, employee or payroll rows were changed by that schema repair.

The uploader supports multipart fields `image`, `file`, or `banner`, plus the existing JSON base64 API. The frontend sends FormData using `image`, letting the browser set the multipart boundary. Missing/invalid files and invalid base64 return 400, files over 5 MiB return 413, and unexpected storage faults return safe 5xx responses. Schema drift is logged by operation/error/table and returns an actionable 503 rather than a raw database message. S3 provider errors no longer expose arbitrary provider messages to clients. Failed/partial uploads retain a cleanup reservation so already-written objects remain discoverable; errors are not silently swallowed.

## Deployment and environment actions

1. Build/deploy the backend and admin together. CI uses Dockerfile.deploy. Prisma CLI was moved to production dependencies so migrations and their transitive dependencies remain available in production installs. No Prisma version upgrade was performed.
2. Verify the existing CampaignImageAsset migration in the actual production database. Run `npx prisma migrate status` and apply the reviewed pending migration through the existing deployment process. Do not use `db push` on production. The local migration result is not proof of production schema readiness.
3. Review and activate `deploy/campaign-storage.compose.yml` alongside the chosen existing Compose file. It mounts a persistent project-scoped volume at `/app/uploads` and fails startup if migration deploy fails, rather than ignoring a required migration error. This overlay has not been activated on production.
4. **Before the first volume-backed deployment**, back up uploads from the existing container and restore them into the new volume. An empty newly mounted volume hides existing container files; replacing the old container before backing it up can lose them. Use a consistent Compose project name for subsequent deployments. For the shell deployment path, add the equivalent persistent `/app/uploads` mount.
5. Confirm the deployed backend has the intended AWS bucket/region/credentials or IAM role in the existing backend integration settings/environment. The configured local environment has no AWS values; that does not establish what is saved in production. No credential values, bucket ACLs, S3 lifecycle rules or Firebase configuration were changed.
6. Set PUBLIC_API_URL to the externally reachable backend root HTTPS origin if legacy local images must appear in FCM payloads. Keep BACKEND_API_URL/NEXT_PUBLIC_API_URL consistent with the chosen backend origin. The built admin rewrite was checked: `/api/:path*` exists and contains no duplicate `/api/api/` prefix. Confirm the built target when deploying a new origin; Next rewrites are captured by the build.
7. Existing Nginx configuration permits 25 MiB requests and forwards paths unchanged; Express allows 10 MiB JSON, enough for a 5 MiB base64 image. Backend proxy timeout is 60 seconds. No arbitrary timeout/body-size increases were applied. Inspect actual deployed Nginx upstream errors and container restart/OOM logs for the original 502.
8. Run the read-only `node dist/scripts/campaignDiagnostics.js campaign_1793030810851_22178914.png` inside the deployed backend. It reports table/configuration-presence and local-file/read-write booleans only, never credential or token values. If using an IAM role, missing static access-key booleans alone do not indicate a configuration error.

Docker CLI/daemon and production infrastructure access were unavailable here, so the Compose overlay was parsed/validated but its container startup and actual volume migration were not run.

## Tests and results

- Backend production TypeScript build: passed.
- Admin Next production build: passed. Separate `tsc --noEmit --incremental false`: passed (the existing Next config skips type errors during its build).
- `scripts/test_campaign_module.cjs`: **9 real Express/Prisma/Sharp end-to-end groups**, using an explicitly selected disposable local PostgreSQL database and isolated FCM/S3 effects. Valid image upload + GET returned 201/200; repeated upload reused the image; no file/invalid image returned 400; oversized multipart returned 413; JSON compatibility returned 201. Create/detail/update preserved the same ID; optional-image create worked; legacy missing-image metadata returned 200/null with imageMissing; ALL_EMPLOYEES eligible/reachable counts matched actual scoped fixture database rows; empty audiences returned zero; invalid input returned 400; foreign-scope CRUD/send/schedule/analytics returned 404; unauthenticated/unauthorized access returned 401/403; storage errors returned safe 500 and schema errors 503; schedule/send/delete worked and repeated send returned 409.
- `npm run test:campaigns`: passed concurrent dispatch/idempotency, token deduplication, compact FCM payloads, actor scope/roles, real image compression, private S3 signing/conditional writes, reference-safe cleanup, missing-image behavior and partial-upload reservations. FCM/S3 network effects are simulated.
- `scripts/test_campaign_module_ui.cjs`: production browser fixture tests passed visible preview failure/retry, audience-change refresh/empty selection, multipart field/boundary, image path rendering, saved-ID reuse after send failure, and explicit invalid-create-response handling. No `/undefined`/`/null` campaign requests or browser exceptions occurred.
- Shared auth service regressions passed. Diff whitespace checks passed.
- Public production checks: health 200; reported image 404. Authenticated production create/edit/upload/preview/send was not exercised without access.

No production pushes, S3 deletions, financial data changes or unrelated schema migrations were performed. Tests write only disposable fixture records; the configured local database schema repair adds only the existing image-asset table/index and migration history.

## Files for this campaign repair

Backend: `src/services/campaignService.ts`, `campaignImageService.ts`, `campaignS3Service.ts`; `src/routes/campaignRoutes.ts`, `uploadRoutes.ts`; `src/scripts/campaignDiagnostics.ts`; `scripts/test_campaign_module.cjs`, `test_campaign_reliability.cjs`, `test_campaign_actor_and_upload.cjs`; `package.json`/`package-lock.json`; `deploy/campaign-storage.compose.yml`; this report.

Admin: `src/services/campaignService.ts`; `src/lib/campaignImages.ts`; `src/features/campaigns/components/CampaignFormModal.tsx`; `src/features/campaigns/pages/CampaignsPage.tsx`; `scripts/test_campaign_module_ui.cjs`.

Concurrent unrelated commission, health-check and permission work was preserved rather than reset.
