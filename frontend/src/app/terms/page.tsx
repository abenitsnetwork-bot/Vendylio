import { LegalPageLayout } from '@/components/legal/LegalPageLayout';
import { LegalMarkdown } from '@/components/legal/LegalMarkdown';
import { getLegalDocument } from '@/lib/server/legal';

// DB-backed: a SUPERADMIN edits this text at Settings → Legal pages
// (falls back to the bundled default until they do).
export const dynamic = 'force-dynamic';

export default async function TermsPage() {
  const doc = await getLegalDocument('terms');
  return (
    <LegalPageLayout title={doc.title} lastUpdated={doc.lastUpdated}>
      <LegalMarkdown source={doc.body} />
    </LegalPageLayout>
  );
}
