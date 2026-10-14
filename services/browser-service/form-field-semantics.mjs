// Runs in the page. Attribute checks also support engines whose reflected
// HTMLInputElement/HTMLSelectElement properties are incomplete.
export function formFieldSemantics() {
  return [...document.querySelectorAll('input,select,textarea')].map(e => {
    const question = e.closest('.application-question');
    const title = question?.querySelector('.application-label .text') ?? question?.querySelector('.application-label');
    const group = e.type === 'checkbox' && /^cards\[[^\]]+\]\[field\d+\]$/.test(e.name)
      && e.closest('[data-qa="checkboxes"]') && question;
    const label = title?.textContent?.replace(/[✱*]\s*$/, '').trim();
    return {
      attribute_required: e.hasAttribute('required') || e.getAttribute('aria-required') === 'true',
      ...(label ? {question_label:label} : {}),
      ...(group ? {group_label:label,selection_group:e.name,group_required:Boolean(e.hasAttribute('required') || title?.querySelector('.required'))} : {}),
    };
  });
}

export function mergeFieldSemantics(fields,semantics) {
  return fields.map((field,i)=>{
    const s=semantics[i]??{};
    return {...field,required:Boolean(field.required||s.attribute_required||s.group_required),
      label:s.question_label&&!['checkbox','radio'].includes(field.type)?s.question_label:field.label,
      ...(s.selection_group?{selection_group:s.selection_group,group_label:s.group_label,group_required:s.group_required}:{})};
  });
}
