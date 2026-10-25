'use client';

import * as React from 'react';
import type { ZodTypeAny, z } from 'zod';
import { toast } from 'sonner';
import { ApiError } from './api';

/** Small form helper: Zod validation on the client, server field errors mapped back to inputs. */
export function useForm<S extends ZodTypeAny>(schema: S | null, initial: Partial<z.input<S>>) {
  const [values, setValues] = React.useState<Record<string, unknown>>(initial as Record<string, unknown>);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);

  const set = React.useCallback((name: string, value: unknown) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => {
      if (!e[name]) return e;
      const next = { ...e };
      delete next[name];
      return next;
    });
  }, []);

  const bind = (name: string) => ({
    name,
    value: (values[name] as string | number | undefined) ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => set(name, e.target.value),
  });

  async function submit(fn: (data: z.infer<S>) => Promise<void>, opts: { toastErrors?: boolean } = {}) {
    let data = values as z.infer<S>;
    if (schema) {
      const parsed = schema.safeParse(values);
      if (!parsed.success) {
        const fe: Record<string, string> = {};
        for (const i of parsed.error.issues) {
          const k = i.path.join('.') || '_';
          fe[k] ??= i.message;
        }
        setErrors(fe);
        const first = Object.keys(fe)[0];
        if (first) document.getElementById(first)?.focus();
        return;
      }
      data = parsed.data;
    }
    setSubmitting(true);
    setErrors({});
    try {
      await fn(data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (Object.keys(err.fields).length) setErrors(err.fields);
        if (opts.toastErrors !== false) toast.error(err.message);
      } else {
        toast.error('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return { values, setValues, set, bind, errors, setErrors, submitting, submit };
}
