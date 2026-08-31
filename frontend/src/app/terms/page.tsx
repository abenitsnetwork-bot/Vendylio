import { LegalPageLayout } from '@/components/legal/LegalPageLayout';
import { TermsContent, TERMS_LAST_UPDATED } from '@/components/legal/TermsContent';

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" lastUpdated={TERMS_LAST_UPDATED}>
      <TermsContent />
    </LegalPageLayout>
  );
}
