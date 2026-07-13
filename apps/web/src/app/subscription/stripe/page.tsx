import { redirect } from "next/navigation";

export default function SubscriptionStripeRedirectPage() {
  redirect("/admin/billing/stripe");
}
