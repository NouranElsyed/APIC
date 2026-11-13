"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { planApi } from "@/features/planning/api";
import { CATEGORY_LABEL, formatSize, type Category } from "./docs";
import type { DocDTO } from "./dto";

const selectCls = "flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";
const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
// Files go through a serverless function, which caps the request body (about 4.5 MB on Vercel).
const MAX_UPLOAD = 4 * 1024 * 1024;

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}

export function FolderSelect({ value, onChange, folders }: { value: string; onChange: (v: string) => void; folders: string[] }) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {folders.map((f) => <option key={f} value={f}>{"\u00a0\u00a0".repeat(f.split("/").length - 1)}{f.split("/").pop()}</option>)}
    </select>
  );
}

// ----------------------------------------------------------------------------- upload
function UploadForm({ onOpenChange, projectId, folders, defaultFolder }: { onOpenChange: (o: boolean) => void; projectId: string; folders: string[]; defaultFolder: string }) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [title, setTitle] = React.useState("");
  const [folder, setFolder] = React.useState(defaultFolder);
  const [category, setCategory] = React.useState<Category>("OTHER");
  const [revision, setRevision] = React.useState("Rev. 00");
  const [busy, setBusy] = React.useState(false);

  function pick(f: File | null) {
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }
  async function submit() {
    if (!file) return;
    if (file.size > MAX_UPLOAD) return void toast.error(`This file is ${formatSize(file.size)}. The upload limit is ${formatSize(MAX_UPLOAD)}.`);
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("title", title.trim() || file.name);
    fd.append("projectId", projectId);
    fd.append("folder", folder);
    fd.append("category", category);
    fd.append("revision", revision);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) toast.error(res.status === 413 ? "The file is too large to upload." : "Failed to upload document");
      else { toast.success("Document uploaded"); onOpenChange(false); router.refresh(); }
    } catch { toast.error("Network error — please try again."); }
    setBusy(false);
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Upload document</DialogTitle><DialogDescription>Choose the file and the folder it belongs in.</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center hover:bg-secondary/50 sm:col-span-2">
          <UploadCloud className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium">{file ? file.name : "Choose a file"}</span>
          <span className="text-xs text-muted-foreground">{file ? formatSize(file.size) : `PDF, DWG, Excel, images… up to ${formatSize(MAX_UPLOAD)}`}</span>
          <input type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </label>
        <Field label="Title" className="sm:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="defaults to the file name" /></Field>
        <Field label="Folder" className="sm:col-span-2"><FolderSelect value={folder} onChange={setFolder} folders={folders} /></Field>
        <Field label="Category"><select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
        <Field label="Revision"><Input value={revision} onChange={(e) => setRevision(e.target.value)} /></Field>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={!file || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Upload</Button></DialogFooter>
    </DialogContent>
  );
}
export function UploadDocumentDialog(props: React.ComponentProps<typeof UploadForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <UploadForm {...rest} />}</Dialog>;
}

// ------------------------------------------------------------------------ new folder
function FolderForm({ onOpenChange, projectId, parent }: { onOpenChange: (o: boolean) => void; projectId: string; parent: string | null }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/document-folders`, { method: "POST", body: { path: parent ? `${parent}/${name}` : name } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Folder created");
    onOpenChange(false);
    router.refresh();
  }
  return (
    <DialogContent className="sm:max-w-sm">
      <DialogHeader><DialogTitle>New folder</DialogTitle><DialogDescription>{parent ? <>Inside <b>{parent}</b>.</> : "At the top level."}</DialogDescription></DialogHeader>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" autoFocus maxLength={40} onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && submit()} />
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={!name.trim() || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Create</Button></DialogFooter>
    </DialogContent>
  );
}
export function NewFolderDialog(props: React.ComponentProps<typeof FolderForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <FolderForm {...rest} />}</Dialog>;
}

// ----------------------------------------------------------------------------- edit
function EditForm({ onOpenChange, doc, folders }: { onOpenChange: (o: boolean) => void; doc: DocDTO; folders: string[] }) {
  const router = useRouter();
  const [title, setTitle] = React.useState(doc.title);
  const [folder, setFolder] = React.useState(doc.folder);
  const [category, setCategory] = React.useState<Category>(doc.category);
  const [revision, setRevision] = React.useState(doc.revision);
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    const r = await planApi(`/api/documents/${doc.id}`, { method: "PATCH", body: { title, folder, category, revision } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Document updated");
    onOpenChange(false);
    router.refresh();
  }
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Edit / move document</DialogTitle><DialogDescription>{doc.fileName}</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Folder" className="sm:col-span-2"><FolderSelect value={folder} onChange={setFolder} folders={folders.includes(folder) ? folders : [...folders, folder]} /></Field>
        <Field label="Category"><select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
        <Field label="Revision"><Input value={revision} onChange={(e) => setRevision(e.target.value)} /></Field>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy || title.trim().length < 2 || !revision.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button></DialogFooter>
    </DialogContent>
  );
}
export function EditDocumentDialog(props: React.ComponentProps<typeof EditForm> & { open: boolean }) {
  const { open, ...rest } = props;
  return <Dialog open={open} onOpenChange={rest.onOpenChange}>{open && <EditForm key={rest.doc.id} {...rest} />}</Dialog>;
}
