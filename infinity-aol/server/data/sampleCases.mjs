export const cases = [
  {
    id: "ELF-2026-0148",
    status: "Fact find complete",
    brokerUser: "ryan.vu",
    submittedBy: null,
    applicants: [
      {
        role: "primary",
        firstName: "Linh",
        middleName: "Mai",
        lastName: "Tran",
        dateOfBirth: "1988-06-14",
        maritalStatus: "Married",
        residencyStatus: "Australian citizen",
        dependants: 2,
        email: "linh.tran@example.com",
        mobile: "0412 345 678",
        address: {
          line1: "12 Market Lane",
          suburb: "Adelaide",
          state: "SA",
          postcode: "5000",
          country: "Australia"
        },
        employment: {
          status: "PAYG",
          employerName: "North Terrace Medical",
          occupation: "Registered Nurse",
          startDate: "2020-02-03"
        },
        income: {
          baseAnnual: 94000,
          overtimeAnnual: 8200,
          bonusAnnual: 0,
          rentalAnnual: 0
        }
      },
      {
        role: "secondary",
        firstName: "Minh",
        middleName: "",
        lastName: "Nguyen",
        dateOfBirth: "1986-11-02",
        maritalStatus: "Married",
        residencyStatus: "Permanent resident",
        dependants: 2,
        email: "minh.nguyen@example.com",
        mobile: "0430 222 999",
        address: {
          line1: "12 Market Lane",
          suburb: "Adelaide",
          state: "SA",
          postcode: "5000",
          country: "Australia"
        },
        employment: {
          status: "Self-employed",
          employerName: "Nguyen Electrical Pty Ltd",
          occupation: "Electrician",
          startDate: "2018-08-20",
          abn: "11 222 333 444"
        },
        income: {
          baseAnnual: 128000,
          overtimeAnnual: 0,
          bonusAnnual: 0,
          rentalAnnual: 0
        }
      }
    ],
    expenses: {
      livingMonthly: 4200,
      rentMonthly: 0,
      educationMonthly: 650,
      insuranceMonthly: 380,
      transportMonthly: 720,
      otherMonthly: 500
    },
    assets: [
      { type: "Cash", description: "Savings account", value: 128000 },
      { type: "Vehicle", description: "2022 Toyota Kluger", value: 42000 },
      { type: "Superannuation", description: "Combined super", value: 188000 }
    ],
    liabilities: [
      {
        type: "Credit card",
        lender: "NAB",
        limit: 12000,
        balance: 1100,
        repaymentMonthly: 240
      },
      {
        type: "Car loan",
        lender: "Toyota Finance",
        limit: 51000,
        balance: 29400,
        repaymentMonthly: 780
      }
    ],
    property: {
      purpose: "Owner occupied purchase",
      address: "8 Rivergum Avenue, Norwood SA 5067",
      purchasePrice: 910000,
      estimatedValue: 910000,
      propertyType: "House",
      titleType: "Torrens",
      bedrooms: 4
    },
    loan: {
      applicationType: "Purchase",
      loanAmount: 728000,
      deposit: 182000,
      lvr: 80,
      productPreference: "Variable",
      repaymentType: "Principal and interest",
      loanTermYears: 30,
      offsetRequested: true
    },
    brokerNotes:
      "Clients want a clean variable P&I option with offset. Secondary applicant has full accountant letter and latest BAS ready.",
    documentChecklist: [
      { name: "Drivers licence - primary", status: "received" },
      { name: "Drivers licence - secondary", status: "received" },
      { name: "Two payslips - primary", status: "received" },
      { name: "FY financials - secondary", status: "pending" },
      { name: "Contract of sale", status: "received" }
    ]
  },
  {
    id: "ELF-2026-0152",
    status: "Needs review",
    brokerUser: "ryan.vu",
    applicants: [
      {
        role: "primary",
        firstName: "Anh",
        middleName: "",
        lastName: "Le",
        dateOfBirth: "",
        maritalStatus: "Single",
        residencyStatus: "Australian citizen",
        dependants: 0,
        email: "anh.le@example.com",
        mobile: "0400 888 111",
        address: {
          line1: "44 King William Street",
          suburb: "Kent Town",
          state: "SA",
          postcode: "5067",
          country: "Australia"
        },
        employment: {
          status: "PAYG",
          employerName: "Adelaide Tech Group",
          occupation: "Business analyst",
          startDate: "2024-07-01"
        },
        income: {
          baseAnnual: 112000,
          overtimeAnnual: 0,
          bonusAnnual: 6500,
          rentalAnnual: 0
        }
      }
    ],
    expenses: {
      livingMonthly: 3100,
      rentMonthly: 2100,
      educationMonthly: 0,
      insuranceMonthly: 190,
      transportMonthly: 480,
      otherMonthly: 350
    },
    assets: [{ type: "Cash", description: "Savings", value: 76000 }],
    liabilities: [],
    property: {
      purpose: "Investment purchase",
      address: "",
      purchasePrice: 640000,
      estimatedValue: 640000,
      propertyType: "Unit",
      titleType: "Strata",
      bedrooms: 2
    },
    loan: {
      applicationType: "Purchase",
      loanAmount: 576000,
      deposit: 64000,
      lvr: 90,
      productPreference: "Fixed 2 years",
      repaymentType: "Interest only",
      loanTermYears: 30,
      offsetRequested: false
    },
    brokerNotes:
      "Missing DOB and property address. LVR above 80 means LMI treatment must be confirmed before AOL push.",
    documentChecklist: [
      { name: "Drivers licence", status: "received" },
      { name: "Two payslips", status: "received" },
      { name: "Contract of sale", status: "pending" }
    ]
  },
  {
    id: "ELF-2026-0159",
    status: "Infinity template ready",
    brokerUser: "ryan.vu",
    clientProfile: {
      currentHousingSituation: "Own Home Mortgage"
    },
    factFind: {
      dateCreditGuideProvided: "2025-07-25",
      dateInterviewConducted: "2025-07-25",
      methodClientInterview: "Face to Face",
      methodDocumentIdentification: "Face to Face"
    },
    applicants: [
      {
        role: "primary",
        title: "Ms.",
        firstName: "LIEN DANG THI KIM",
        middleName: "",
        lastName: "HOANG",
        dateOfBirth: "1994-08-01",
        gender: "Female",
        maritalStatus: "Single",
        residencyStatus: "Permanent resident",
        dependants: 0,
        email: "Lienhoang.huflit@yahoo.com.vn",
        mobile: "0490043836",
        id: {
          driversLicenceNo: "EA2889",
          licenceExpiryDate: "2034-08-20",
          licenceState: "SA",
          licenceClass: "F"
        },
        address: {
          line1: "2 Euston Street",
          suburb: "Mansfield Park",
          state: "SA",
          postcode: "5012",
          country: "Australia"
        },
        employment: {
          status: "PAYG",
          employerName: "HOANG, LIEN DANG THI KIM",
          occupation: "Employee",
          startDate: "2023-01-01"
        },
        income: {
          baseAnnual: 130600,
          overtimeAnnual: 0,
          bonusAnnual: 0,
          rentalAnnual: 26000
        }
      }
    ],
    expenses: {
      livingMonthly: 3000,
      rentMonthly: 0,
      educationMonthly: 0,
      insuranceMonthly: 200,
      transportMonthly: 500,
      otherMonthly: 2300
    },
    assets: [
      { type: "Superannuation", description: "", value: 30000 },
      { type: "Motor Vehicle", description: "", value: 20000 },
      { type: "Deposit Account", description: "", value: 70000 },
      { type: "Real Estate", description: "Mansfield Park", value: 800000 },
      { type: "Real Estate", description: "PARAFIELD GARDENS", value: 840000 }
    ],
    liabilities: [
      {
        type: "Mortgage Loan",
        lender: "ANZ",
        description: "Parafield Garden",
        interestRate: 5.74,
        limit: 613519,
        balance: 613519,
        repaymentMonthly: 0
      }
    ],
    property: {
      purpose: "Investment purchase",
      address: "TBC Parafield Gardens SA 5107",
      shortName: "TBC PARAFIELD GARDENS",
      purchasePrice: 840000,
      estimatedValue: 840000,
      propertyType: "House",
      titleType: "Torrens",
      bedrooms: 3
    },
    loan: {
      applicationType: "Purchase",
      opportunityName: "Purchase Investment Property",
      lender: "Pepper Money",
      loanAmount: 390000,
      deposit: 450000,
      lvr: 46,
      productPreference: "Variable",
      repaymentType: "Principal and Interest",
      loanTermYears: 40,
      estimatedSettlementDate: "2025-08-25",
      offsetRequested: true,
      preApproval: true
    },
    brokerNotes:
      "Client is seeking pre-approval to buy an investment property. Pepper Money selected for stronger servicing and competitive variable P&I option with redraw and offset.",
    documentChecklist: [
      { name: "Drivers licence", status: "received" },
      { name: "Income evidence", status: "received" },
      { name: "Bank statement", status: "received" },
      { name: "Current mortgage statement", status: "received" }
    ]
  }
];
