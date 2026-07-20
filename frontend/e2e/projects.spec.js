import { expect, test } from '@playwright/test';

const PROJECT_NAME = 'Revamped Knowledge Base';
const EXPECTED_DOCUMENTS = Number(process.env.E2E_EXPECTED_DOCS || 7);
const EXPECTED_UNSUPPORTED = Number(process.env.E2E_EXPECTED_UNSUPPORTED || 2);

test.describe.configure({ mode: 'serial' });

async function loginAs(page, userId) {
  await expect(page.getByText('Select a seeded prototype user')).toBeVisible();
  await page.getByLabel('Select a seeded prototype user').selectOption(userId);
  await page.getByRole('button', { name: 'Enter AI workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
}

async function openProject(page) {
  const card = page.getByTestId('project-card').filter({ hasText: PROJECT_NAME });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole('heading', { name: PROJECT_NAME, exact: true })).toBeVisible();
}

function isProjectResponse(response, suffix, method = 'POST') {
  const url = new URL(response.url());
  return response.request().method() === method
    && url.pathname.startsWith('/api/projects/')
    && url.pathname.endsWith(suffix);
}

function isSourceItemResponse(response, method) {
  const url = new URL(response.url());
  return response.request().method() === method
    && /^\/api\/projects\/[^/]+\/sources\/[^/]+$/.test(url.pathname);
}

test('manager creates and assigns project learning that an employee completes', async ({ page }) => {
  await test.step('manager signs in directly on the Projects route', async () => {
    await page.goto('/projects');
    await loginAs(page, 'USR003');
    await expect(page).toHaveURL(/\/projects$/);
    await openProject(page);
  });

  await test.step('manager validates Confluence, creates and removes a page resource', async () => {
    await expect(page.getByTestId('source-resources-panel')).toBeVisible();
    await expect(page.getByTestId('source-resource')).toHaveCount(1);
    await page.getByTestId('add-project-source').click();
    await page.getByTestId('source-type-confluence').click();
    await page.getByTestId('source-name').fill('Engineering wiki');
    await page.getByTestId('confluence-page-urls').fill('https://github.com/acme/pages/123');
    await page.getByTestId('save-project-source').click();
    await expect(page.getByText(/Use Atlassian Cloud page links/)).toBeVisible();

    await page.getByTestId('confluence-page-urls').fill(
      'https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Handbook\n'
      + 'https://acme.atlassian.net/wiki/spaces/ENG/pages/456/Runbooks',
    );
    const [createResponse] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/sources')),
      page.getByTestId('save-project-source').click(),
    ]);
    expect(createResponse.status()).toBe(201);
    await expect(page.getByTestId('source-resource').filter({ hasText: 'Engineering wiki' })).toBeVisible();

    const wiki = page.getByTestId('source-resource').filter({ hasText: 'Engineering wiki' });
    page.once('dialog', (dialog) => dialog.accept());
    const [deleteResponse] = await Promise.all([
      page.waitForResponse((candidate) => isSourceItemResponse(candidate, 'DELETE')),
      wiki.getByTestId('delete-source').click(),
    ]);
    expect(deleteResponse.ok()).toBeTruthy();
    await expect(wiki).toHaveCount(0);
  });

  await test.step('manager adds and tests a second local resource', async () => {
    await page.getByTestId('add-project-source').click();
    await page.getByTestId('source-name').fill('Architecture subset');
    await page.getByTestId('source-subpath').fill('architecture');
    const [createResponse] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/sources')),
      page.getByTestId('save-project-source').click(),
    ]);
    expect(createResponse.status()).toBe(201);

    const resource = page.getByTestId('source-resource').filter({ hasText: 'Architecture subset' });
    await expect(resource).toBeVisible();
    const [testResponse] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/test')),
      resource.getByTestId('test-source').click(),
    ]);
    expect(testResponse.ok()).toBeTruthy();
    expect((await testResponse.json()).ok).toBe(true);
  });

  await test.step('manager syncs the complete supported corpus', async () => {
    const [response] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/sync')),
      page.getByTestId('sync-project').click(),
    ]);
    expect(response.ok()).toBeTruthy();

    const result = await response.json();
    expect(result.sourceSummary).toMatchObject({
      documentCount: EXPECTED_DOCUMENTS,
      skippedUnsupported: EXPECTED_UNSUPPORTED,
    });
    await expect(page.locator('.project-document')).toHaveCount(EXPECTED_DOCUMENTS);
  });

  await test.step('manager generates and publishes a fresh draft revision', async () => {
    const [generateResponse] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/courses/generate')),
      page.getByTestId('generate-course').click(),
    ]);
    expect(generateResponse.ok()).toBeTruthy();
    expect((await generateResponse.json()).status).toBe('draft');

    const publishButtons = page.getByTestId('publish-course');
    await expect(publishButtons.first()).toBeVisible();
    const draftCount = await publishButtons.count();

    const [publishResponse] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/publish')),
      publishButtons.first().click(),
    ]);
    expect(publishResponse.ok()).toBeTruthy();
    expect((await publishResponse.json()).status).toBe('published');
    await expect.poll(() => publishButtons.count()).toBe(draftCount - 1);
    await expect(page.locator('.project-course').filter({ hasText: 'Published' }).first()).toBeVisible();
  });

  await test.step('manager assigns only USR001', async () => {
    const employees = page.locator('.employee-option');
    await expect(employees.filter({ hasText: 'Ameya Sutar' })).toHaveCount(1);

    for (let index = 0; index < await employees.count(); index += 1) {
      const employee = employees.nth(index);
      const isUsr001 = (await employee.textContent()).includes('Ameya Sutar');
      await employee.getByRole('checkbox').setChecked(isUsr001);
    }

    const [response] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/assignments')),
      page.getByTestId('assign-course').click(),
    ]);
    expect(response.ok()).toBeTruthy();
    const assignment = await response.json();
    expect(assignment.assignedCount).toBe(1);
    expect(assignment.assignments).toEqual([
      expect.objectContaining({ employeeId: 'USR001' }),
    ]);
  });

  await test.step('USR001 switches in and opens Projects by its direct URL', async () => {
    await page.getByRole('button', { name: 'Switch', exact: true }).click();
    await loginAs(page, 'USR001');
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/projects$/);
    await openProject(page);
  });

  await test.step('employee answers every question and receives a score report', async () => {
    const [startResponse] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/attempts')),
      page.getByTestId('start-course').click(),
    ]);
    expect(startResponse.ok()).toBeTruthy();

    const questions = page.locator('.project-question');
    await expect(questions.first()).toBeVisible();
    const questionCount = await questions.count();
    expect(questionCount).toBeGreaterThan(0);

    for (let index = 0; index < questionCount; index += 1) {
      const firstOption = questions.nth(index).getByTestId('question-option').first();
      await firstOption.click();
      await expect(firstOption.getByRole('radio')).toBeChecked();
    }

    const [submitResponse] = await Promise.all([
      page.waitForResponse((candidate) => isProjectResponse(candidate, '/submit')),
      page.getByTestId('submit-course').click(),
    ]);
    expect(submitResponse.ok()).toBeTruthy();

    await expect(page.getByTestId('course-report')).toBeVisible();
    await expect(page.getByTestId('course-score')).toContainText(/^\d+%/);
  });
});
