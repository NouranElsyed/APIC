"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadForm } from "@/features/documents/upload-form";

export function ProjectDocumentUpload({
  projectId,
  projectLabel,
  canUpload,
}: {
  projectId: string;
  projectLabel: string;
  canUpload: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  if (!canUpload) return null;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Upload Document
      </Button>
      <UploadForm
        open={open}
        onOpenChange={setOpen}
        projects={[]}
        lockedProjectId={projectId}
        lockedProjectLabel={projectLabel}
        onSaved={() => router.refresh()}
      />
    </>
  );
}
