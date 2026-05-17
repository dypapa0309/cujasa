import 'dotenv/config';
import { analyzeImportedPolibotExtractionGaps } from '../services/polibotKnowledgeDbService.js';

const limit = Number(process.argv[2] || 5000);

const report = await analyzeImportedPolibotExtractionGaps({ limit });
const compact = {
  generatedAt: report.generatedAt,
  totals: report.totals,
  priorityDocuments: report.priorityDocuments.slice(0, 12).map((doc) => ({
    id: doc.id,
    fileName: doc.fileName,
    analysisPriority: doc.analysisPriority,
    recommendedAction: doc.recommendedAction,
    catalogRows: doc.catalogRows,
    premiumRows: doc.premiumRows,
    linkedPremiumRows: doc.linkedPremiumRows,
    unlinkedPremiumRows: doc.unlinkedPremiumRows,
    linkedBenefitGroups: doc.linkedBenefitGroups,
    strongLinkedBenefitGroups: doc.strongLinkedBenefitGroups,
    usableLinkedBenefitGroups: doc.usableLinkedBenefitGroups,
    weakLinkedGroups: doc.weakLinkedGroups,
    missingCoverage: doc.missingCoverage,
    missingAge: doc.missingAge,
    missingRenewal: doc.missingRenewal,
    premiumGapSamples: doc.premiumGaps.slice(0, 3),
    linkedGroupGapSamples: doc.linkedGroupGaps.slice(0, 3)
  }))
};

console.log(JSON.stringify(compact, null, 2));
