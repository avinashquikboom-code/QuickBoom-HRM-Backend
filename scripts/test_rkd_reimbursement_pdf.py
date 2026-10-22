"""Verify the actual PDF emitted by test_rkd_payroll_wallet.cjs --reimbursements."""
import re
import sys
from pypdf import PdfReader

source = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rkd-reimbursements-salary-slip.pdf'
text = '\n'.join(page.extract_text() or '' for page in PdfReader(source).pages)
for value in ['RKD-1', 'RKD-2', '500.00', '1,250.00', '2,000.00', '17,200.00', 'Seventeen Thousand Two Hundred Rupees Only']:
    assert value in text, value
assert len(re.findall(r'RKD Incentive \(RKD-[12]\)', text)) == 2
assert text.index('RKD Incentive') > text.index('Reimbursements / Expenses')
assert 'Gross Earnings ₹15,000.00' in text
print('PASS actual PDF: both RKD entries under reimbursements only, gross 15000, reimbursements 2000, take-home 17200 and correct amount-in-words.')
