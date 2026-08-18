import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, Building2, FileText, User } from "lucide-react";
import { getProject } from "@/server/services/project.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectStatusBadge, ProjectStageBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { ProjectDocumentUpload } from "@/features/projects/project-document-upload";
import { ProjectCorrespondenceSection } from "@/features/projects/project-correspondence-section";
import { ProjectScopeSection } from "@/features/projects/project-scope-section";
import { ProjectNoticesSection } from "@/features/projects/project-notices-section";
import { ProjectMeetingMinutesSection } from "@/features/projects/project-meeting-minutes-section";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, session] = await Promise.all([getProject(id), auth()]);
  if (!project) notFound();
  const canUpload = can(session?.user.role, "documents.create");

  const generalDocuments = project.documents.filter((d) => d.category !== "EMAIL");
  const mailDocs = project.documents.filter((d) => d.category === "EMAIL");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/projects"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
            <ProjectStageBadge stage={project.stage} />
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="text-xs text-muted-foreground">{project.number} · {project.revision}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle>Project Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{project.description || "No description provided."}</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {project.stage === "TENDERING" ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" /> Tender Due: <span className="text-foreground">{formatDate(project.dueDate)}</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" /> Start: <span className="text-foreground">{formatDate(project.startDate)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" /> End: <span className="text-foreground">{formatDate(project.endDate)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" /> Created by: <span className="text-foreground">{project.createdBy.name}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <FileText className="h-4 w-4" /> Documents: <span className="text-foreground">{project.documents.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Client</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{project.customer.name}</span>
            </div>
            <Badge variant="outline">{project.customer.code}</Badge>
            {project.customer.contact && <p className="text-xs font-medium text-foreground">{project.customer.contact}</p>}
            <p className="text-xs text-muted-foreground">{project.customer.email || "No email on file"}</p>
            <p className="text-xs text-muted-foreground">{project.customer.phone || "No phone on file"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Project Documents</CardTitle>
          <ProjectDocumentUpload
            projectId={project.id}
            projectLabel={`${project.number} — ${project.name}`}
            canUpload={canUpload}
          />
        </CardHeader>
        <CardContent>
          {generalDocuments.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description={canUpload ? "Upload the first document for this project." : "Upload documents from the Documents module."}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Revision</TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {generalDocuments.map((d: (typeof project.documents)[number]) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.title}</TableCell>
                    <TableCell><Badge variant="secondary">{d.category.replace("_", " ")}</Badge></TableCell>
                    <TableCell>{d.revision}</TableCell>
                    <TableCell>{d.uploadedBy.name}</TableCell>
                    <TableCell>{formatDate(d.uploadDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ProjectScopeSection
          projectId={project.id}
          items={project.scopeItems}
          canManage={canUpload}
        />
        <ProjectNoticesSection
          projectId={project.id}
          notices={project.notices}
          canManage={canUpload}
        />
        <ProjectMeetingMinutesSection
          projectId={project.id}
          meetings={project.meetingMinutes}
          canManage={canUpload}
        />
        <ProjectCorrespondenceSection
          projectId={project.id}
          projectLabel={`${project.number} — ${project.name}`}
          category="EMAIL"
          sectionTitle="Mails"
          emptyLabel="No mails added"
          documents={mailDocs}
          canUpload={canUpload}
        />
      </div>
    </div>
  );
}
