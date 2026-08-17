import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { CustomersView } from "@/features/customers/customers-view";

export default async function CustomersPage() {
  const session = await auth();
  const role = session?.user.role;
  return (
    <CustomersView
      canCreate={can(role, "customers.create")}
      canEdit={can(role, "customers.edit")}
      canDelete={can(role, "customers.delete")}
    />
  );
}
