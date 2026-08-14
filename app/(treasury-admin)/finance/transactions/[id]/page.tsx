import { TransactionReviewPanel } from "@/components/treasury/admin/transaction-review";

export default async function FinanceTransactionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TransactionReviewPanel transactionId={id} />;
}
