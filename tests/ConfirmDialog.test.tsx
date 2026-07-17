import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ConfirmDialog } from '../src/components/ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="x"
        body="y"
        confirmLabel="Go"
        cancelLabel="No"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps confirm disabled until the required phrase is typed, then confirms with the reason', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Clear everything?"
        body="This can't be undone."
        confirmLabel="Clear everything"
        cancelLabel="Cancel"
        reason={{ label: 'Reason (optional)' }}
        requirePhrase={{ label: 'Type DELETE to confirm', phrase: 'DELETE' }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Clear everything' })
    expect(confirm).toBeDisabled()

    // Two text controls: the reason textarea, then the phrase input.
    const [reasonBox, phraseBox] = within(dialog).getAllByRole('textbox')
    fireEvent.change(reasonBox, { target: { value: 'clearing test data' } })
    fireEvent.change(phraseBox, { target: { value: 'WRONG' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(phraseBox, { target: { value: 'DELETE' } })
    expect(confirm).not.toBeDisabled()

    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('clearing test data')
  })
})
