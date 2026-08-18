"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Download, ClipboardList, Bell, Users2, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { UploadForm } from "@/features/documents/upload-form";
import { formatDate } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  SCOPE_OF_WORK: ClipboardList,
  NOTICE: Bell,
  MEETING_MINUTES: Users2,
  EMAIL: Mail,
};

export interface ProjectCorrespondenceDoc {
  id: string;
  title: string;
  revision: string;
  filePath: string;
  uploadDate: string | Date;
  uploadedBy: { name: string };
}

export function ProjectCorrespondenceSection({
  projectId,
  projectLabel,
  category,
  sectionTitle,
  emptyLabel,
  documents,
  canUpload,
}: {
  projectId: string;
  projectLabel: string;
  category: string;
  sectionTitle: string;
  emptyLabel: string;
  documents: ProjectCorrespondenceDoc[];
  canUpload: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const Icon = ICONS[category] ?? ClipboardList;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" /> {sectionTitle}
        </CardTitle>
        {canUpload && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <EmptyState icon={Icon} title={emptyLabel} description={canUpload ? "Nothing added yet — use Add to upload one." : "Nothing added yet."} />
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.revision} · {d.uploadedBy.name} · {formatDate(d.uploadDate)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" asChild>
                  <a href={d.filePath} download target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <UploadForm
        open={open}
        onOpenChange={setOpen}
        projects={[]}
        lockedProjectId={projectId}
        lockedProjectLabel={projectLabel}
        lockedCategory={category}
        title={`Add ${sectionTitle.replace(/s$/, "")}`}
        onSaved={() => router.refresh()}
      />
    </Card>
  );
}
