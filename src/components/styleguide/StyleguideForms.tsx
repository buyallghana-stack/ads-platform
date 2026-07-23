'use client'

import { useState } from 'react'

import { Checkbox } from '@/components/ui/Checkbox'
import { PasswordField } from '@/components/ui/PasswordField'
import { TextField } from '@/components/ui/TextField'

/**
 * Live form controls for the styleguide. Client-side so the password meter and
 * checkbox actually respond — a static screenshot of a strength meter proves
 * nothing about whether it works.
 */
export function StyleguideForms() {
  const [password, setPassword] = useState('Str0ng!pass')
  const [checked, setChecked] = useState(true)

  return (
    <div className="grid gap-5 rounded-(--radius-card) border border-ink-200 bg-surface p-4 md:grid-cols-2">
      <div className="flex flex-col gap-4">
        <TextField label="Default" placeholder="you@example.com" />
        <TextField
          label="With hint"
          placeholder="024 123 4567"
          hint="Used to keep accounts secure. We will not call you."
        />
        <TextField
          label="With error"
          defaultValue="not-an-email"
          error="That does not look like a valid email address"
        />
        <TextField label="Optional" optionalLabel="optional" placeholder="8 characters" />
        <TextField label="Disabled" placeholder="Cannot edit" disabled />
      </div>

      <div className="flex flex-col gap-4">
        <PasswordField
          label="Password with live rules"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Create a strong password"
        />
        <PasswordField
          label="Password, no checklist"
          value=""
          showChecklist={false}
          placeholder="Your password"
          onChange={() => {}}
        />
        <Checkbox
          label="I agree to the Terms of Service and Privacy Policy."
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <Checkbox label="With an error" error="You need to accept the terms to continue" />
      </div>
    </div>
  )
}
