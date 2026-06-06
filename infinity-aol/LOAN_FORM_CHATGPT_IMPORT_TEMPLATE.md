# Easy Loan Finance - Full Loan Form JSON Import Template

Use this file as the master JSON structure for a complete Easy Loan Finance loan application. Send it to ChatGPT with a client case, then paste the completed JSON into Loan Case Manager > Import Case JSON.

## Prompt To Send ChatGPT

Complete the full Easy Loan Finance Loan Form JSON template below from the client case information I provide.

Rules:
- Return JSON only. No markdown, no explanation.
- Keep all keys exactly as written.
- Use Australian date format `DD-MM-YYYY`.
- Use numbers without `$`, commas, or text where possible.
- If a value is unknown, use an empty string.
- Do not invent details.
- Split names into `firstName` and `surname`.
- If there is a spouse, partner, co-borrower, guarantor, or second applicant, complete `secondApplicant`.
- If the loan type is not relevant, leave that loan section blank.
- Put anything uncertain or extra into `lenderNotes.additionalNotes`.
- Preserve this full structure even when sections are blank, so it can be imported consistently.

## Full JSON Template

```json
{
  "applicantDetails": {
    "firstName": "Alex",
    "surname": "Nguyen",
    "dateOfBirth": "01-01-1990",
    "gender": "Male",
    "email": "alex@example.com",
    "mobile": "0400000000",
    "maritalStatus": "Single",
    "dependants": "0",
    "residencyStatus": "Australian citizen",
    "permanentInAustralia": "Yes",
    "visaSubclass": "",
    "driversLicenceNo": "D1234567",
    "licenceExpiryDate": "01-01-2030",
    "licenceState": "SA",
    "licenceClass": "C",
    "currentHousingSituation": "Renting",
    "currentResidentialStatus": "Renting",
    "address": "1 Example Street Adelaide SA 5000",
    "currentSuburb": "Adelaide",
    "currentState": "SA",
    "currentPostcode": "5000",
    "currentAddressFromDate": "01-01-2022",
    "previousAddress": "",
    "postSettlementAddress": "",
    "mailingAddress": "",
    "secondApplicant": {
      "firstName": "",
      "surname": "",
      "dateOfBirth": "",
      "gender": "",
      "email": "",
      "mobile": "",
      "maritalStatus": "",
      "dependants": "",
      "residencyStatus": "",
      "permanentInAustralia": "Yes",
      "visaSubclass": "",
      "driversLicenceNo": "",
      "licenceExpiryDate": "",
      "licenceState": "",
      "licenceClass": "C",
      "address": "",
      "currentSuburb": "",
      "currentState": "",
      "currentPostcode": "",
      "currentAddressFromDate": "",
      "previousAddress": ""
    }
  },
  "loanDetails": {
    "loanType": "Home loan",
    "loanPurpose": "Purchase owner occupied dwelling",
    "loanAmount": "500000",
    "propertyValue": "750000",
    "depositEquity": "250000",
    "propertyLocation": "1 Example Street Adelaide SA 5000",
    "timeline": "Pre-approval",
    "loanTermYears": "30",
    "repaymentType": "Principal & Interest",
    "ratePreference": "Variable",
    "offsetRequested": "Yes",
    "redrawRequested": "Yes",
    "settlementDate": "",
    "financeClauseDate": "",
    "isFirstHomeBuyer": "No",
    "fhogRequired": "No",
    "isConstruction": "No",
    "isRefinance": "No",
    "hemMonthly": "3200"
  },
  "employment": {
    "employmentType": "PAYG",
    "employerName": "Example Employer Pty Ltd",
    "occupation": "Accountant",
    "employmentBasis": "Full time",
    "employmentFromDate": "01-01-2020",
    "secondApplicant": {
      "employmentType": "",
      "employerName": "",
      "jobTitle": "",
      "employmentBasis": "",
      "employmentFromDate": ""
    }
  },
  "income": {
    "annualIncome": "90000",
    "primaryAnnualIncome": "90000",
    "secondAnnualIncome": "",
    "secondaryAnnualIncome": "",
    "rentalIncomeAnnual": "",
    "bonusAnnual": "",
    "overtimeAnnual": "",
    "otherIncomeAnnual": ""
  },
  "assets": {
    "financialAssetBuffer": "30000",
    "cashSavingsAmount": "30000",
    "depositAccountBalance": "30000",
    "superannuationValue": "",
    "motorVehicleModelYear": "",
    "motorVehicleValue": "",
    "realEstateAssetAddress": "",
    "realEstateAssetValue": "",
    "otherAssetsSummary": ""
  },
  "liabilities": {
    "existingDebtsSummary": "",
    "currentLender": "",
    "currentLoanBalance": "",
    "creditCardLimit": "",
    "personalLoanBalance": "",
    "carLoanBalance": "",
    "hecsBalance": "",
    "buyNowPayLaterBalance": ""
  },
  "expenses": {
    "hemMonthly": "3200",
    "generalExpenses": "3200",
    "rentMonthly": "",
    "mortgageRepaymentMonthly": "",
    "childcareMonthly": "",
    "insuranceMonthly": "",
    "transportMonthly": "",
    "groceriesMonthly": "",
    "utilitiesMonthly": ""
  },
  "creditFile": {
    "creditIssue": "No",
    "hasCreditIssue": "No",
    "paydayLoans": "No",
    "bnplUse": "No",
    "gamblingTransactions": "No",
    "dishonoursHistory": "No",
    "hardshipHistory": "No",
    "recentDeclines": "No",
    "arrearsOrMissedRepayments": "No",
    "creditIssueNotes": ""
  },
  "homeLoan": {
    "propertyFoundStatus": "",
    "purchasePrice": "",
    "depositSource": "",
    "contractStatus": "",
    "auction": "",
    "propertyAddress": "",
    "occupancy": "",
    "constructionDetails": ""
  },
  "refinance": {
    "currentLender": "",
    "currentLoanBalance": "",
    "currentInterestRate": "",
    "monthlyRepayment": "",
    "repaymentType": "",
    "fixedVariable": "",
    "fixedExpiryDate": "",
    "offsetBalance": "",
    "redrawBalance": "",
    "propertyAddress": "",
    "estimatedValue": "",
    "refinanceReason": "",
    "cashOutAmount": "",
    "cashOutPurpose": "",
    "debtConsolidationDebts": "",
    "payoutDetails": "",
    "arrearsHistory": ""
  },
  "commercialLoan": {
    "borrowerEntity": "",
    "abn": "",
    "acn": "",
    "entityType": "",
    "directors": "",
    "guarantors": "",
    "commercialPropertyAddress": "",
    "propertyType": "",
    "estimatedValue": "",
    "purchasePrice": "",
    "zoning": "",
    "ownerOccupiedOrInvestment": "",
    "leaseDetails": "",
    "annualRent": "",
    "tenantDetails": "",
    "currentCommercialLoanDetails": "",
    "incomeEvidenceAvailable": "",
    "financialsAvailable": "",
    "basAvailable": "",
    "bankStatementsAvailable": "",
    "cashOutPurpose": ""
  },
  "businessLoan": {
    "businessLegalName": "",
    "tradingName": "",
    "abn": "",
    "acn": "",
    "entityType": "",
    "gstRegistered": "",
    "abnStartDate": "",
    "industry": "",
    "businessAddress": "",
    "ownersDirectors": "",
    "loanPurpose": "",
    "loanAmount": "",
    "termYears": "",
    "securedUnsecured": "",
    "monthlyRevenue": "",
    "annualTurnover": "",
    "netProfit": "",
    "existingBusinessDebts": "",
    "atoDebtPaymentPlan": "",
    "bankStatementsAvailable": "",
    "basAvailable": "",
    "taxReturnsAvailable": "",
    "equipmentQuoteInvoice": ""
  },
  "carLoan": {
    "personalOrBusinessUse": "",
    "applicantType": "",
    "vehicleMake": "",
    "vehicleModel": "",
    "vehicleYear": "",
    "vehicleVariant": "",
    "vin": "",
    "rego": "",
    "odometer": "",
    "purchasePrice": "",
    "deposit": "",
    "sellerType": "",
    "dealerInvoiceAvailable": "",
    "privateSellerDetails": "",
    "balloonResidual": "",
    "loanTermYears": "",
    "insuranceStatus": "",
    "refinancePayoutDetails": "",
    "businessUsePercentage": "",
    "chattelMortgageRequired": ""
  },
  "personalLoan": {
    "purpose": "",
    "loanAmount": "",
    "loanTermYears": "",
    "securedUnsecured": "",
    "fundingTimeframe": "",
    "quoteInvoiceAvailable": "",
    "debtConsolidationDetails": "",
    "paydayLoans": "",
    "bnpl": "",
    "gamblingTransactions": "",
    "dishonours": "",
    "hardship": "",
    "recentDeclines": ""
  },
  "documents": {
    "identityDocuments": "Driver licence front/back",
    "incomeDocuments": "Payslips or accountant letter",
    "bankStatements": "",
    "contractOfSale": "",
    "ratesNotice": "",
    "rentalStatement": "",
    "commercialDocuments": "",
    "businessDocuments": "",
    "vehicleDocuments": "",
    "otherDocuments": ""
  },
  "consents": {
    "privacyConsent": "Yes",
    "creditCheckConsent": "Yes",
    "marketingConsent": "No"
  },
  "lenderNotes": {
    "brokerNotes": "",
    "additionalNotes": "",
    "clientObjectives": "",
    "recommendedLender": "",
    "loanStructureNotes": "",
    "riskNotes": "",
    "followUpRequired": ""
  }
}
```
