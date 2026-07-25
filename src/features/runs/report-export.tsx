'use client';

import * as React from 'react';
import { Download, FileCode, FileJson, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/overlays';

/**
 * Report export.
 *
 * Markdown, HTML and JSON are generated server-side and downloaded directly.
 *
 * PDF opens the HTML report in a new tab and triggers the browser's own print
 * dialog. That is a deliberate choice over bundling headless Chromium: it adds
 * roughly 300 MB to the deployment, does not run on most serverless targets,
 * and produces a worse result than the print engine already sitting in the
 * user's browser — which also lets them adjust margins and page size.
 */
export function ReportExport({ runId }: { runId: string }) {
  const [open, setOpen] = React.useState(false);

  const download = (format: 'markdown' | 'html' | 'json') => {
    const url = `/api/v1/runs/${runId}/report?format=${format}&download=1`;
    window.location.href = url;
    toast.success('Report downloading', {
      description: `Generating the ${format} export.`,
    });
    setOpen(false);
  };

  const printPdf = () => {
    const tab = window.open(`/api/v1/runs/${runId}/report?format=html`, '_blank');
    if (!tab) {
      toast.error('Popup blocked', {
        description: 'Allow popups for this site, then try again.',
      });
      return;
    }
    // Give the document a moment to lay out before invoking print, otherwise
    // the dialog can open against an empty page.
    tab.addEventListener('load', () => setTimeout(() => tab.print(), 400), {
      once: true,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Download />
          Export report
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Export report"
        description="A self-contained comparison report with the executive summary, model table and every response."
      >
        <div className="space-y-2">
          <ExportOption
            icon={<FileText className="size-4" />}
            title="Markdown"
            description="For pull requests, wikis and issue threads."
            onClick={() => download('markdown')}
          />
          <ExportOption
            icon={<FileCode className="size-4" />}
            title="HTML"
            description="Styled, print-ready, and works offline as a single file."
            onClick={() => download('html')}
          />
          <ExportOption
            icon={<Printer className="size-4" />}
            title="PDF"
            description="Opens the HTML report and your browser's print dialog. Choose “Save as PDF”."
            onClick={printPdf}
          />
          <ExportOption
            icon={<FileJson className="size-4" />}
            title="JSON"
            description="Full structured data, for your own analysis or archiving."
            onClick={() => download('json')}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExportOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-line hover:border-line-strong hover:bg-surface-raised flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors"
    >
      <span className="text-ink-subtle mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="text-ink block text-[13px] font-medium">{title}</span>
        <span className="text-ink-subtle mt-0.5 block text-[12px] leading-relaxed">
          {description}
        </span>
      </span>
    </button>
  );
}
