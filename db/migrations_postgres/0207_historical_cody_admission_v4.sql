-- DEE-993: corrected Cody evidence predicates only. No existing records are modified.
DROP POLICY IF EXISTS historical_scientific_admission_runner_insert_v2
  ON public.trader_scientific_admission_receipt_v1;
CREATE POLICY historical_scientific_admission_runner_insert_v2
  ON public.trader_scientific_admission_receipt_v1
  FOR INSERT TO waia_historical_runner
  WITH CHECK (
    organization_id='3c50b4e9-1138-43a5-a29f-e65088124cfc'::uuid
    AND (
      (
        receipt_kind='WF_PREDICTIVE_FOUR_SURFACE'
        AND schema_version='scientific-admission-four-surface/v2'
        AND selected_k_config_dec IS NULL AND selected_m_config_dec IS NULL
        AND selected_package_generation_identity_digest IS NULL
        AND selected_package_content_digest IS NULL
        AND receipt_json::jsonb->>'schemaVersion'=schema_version
        AND receipt_json::jsonb->>'receiptKind'=receipt_kind
        AND receipt_json::jsonb->>'terminalStatus'='SCIENTIFICALLY_ADMITTED'
        AND receipt_json::jsonb->>'organizationId'=organization_id::text
        AND receipt_json::jsonb->>'kmGlobalAnchorSetDigestHex'=km_global_anchor_set_digest
        AND receipt_json::jsonb->>'aggregateFamilySetDigestHex'=
          replica_root_family_identity_digest
        AND receipt_json::jsonb->>'alphaEpiConfigScale8'=alpha_epi_config_scale8
        AND receipt_json::jsonb->>'evidenceSemanticDigestHex'=evidence_semantic_digest
        AND receipt_json::jsonb->>'contentDigestHex'=content_digest
        AND receipt_json::jsonb->'authorityBoundary'=jsonb_build_object(
          'capitalAuthority','NONE','liveTradingAuthority','NONE',
          'blindHoldoutAuthority','FORBIDDEN_NOT_PRESENT_NOT_ACCESSED',
          'humanRatificationAuthority','NOT_CLAIMED_BY_THIS_RECEIPT')
        AND EXISTS (
          SELECT 1
          FROM public.trader_historical_ratification_request_v2 request
          WHERE request.organization_id=
              trader_scientific_admission_receipt_v1.organization_id
            AND request.run_id=receipt_json::jsonb->>'runId'
            AND request.release_sha=receipt_json::jsonb->>'releaseSha'
            AND request.request_json::jsonb->>'contentDigestHex'=request.content_digest_hex
            AND request.request_json::jsonb->>'schemaVersion'=
              'waia.trader.historical_ratification_request.v2'
            AND request.request_json::jsonb->>'organizationId'=request.organization_id::text
            AND request.request_json::jsonb->>'runId'=request.run_id
            AND request.request_json::jsonb->>'releaseSha'=request.release_sha
            AND request.request_json::jsonb->>'humanDecision'=
              'REQUEST_EXACT_PRE_HOLDOUT_TECHNICAL_PROPOSAL'
            AND request.request_json::jsonb->'authorityBoundary'=jsonb_build_object(
              'capitalAuthority','NONE','liveTradingAuthority','NONE',
              'blindHoldoutAuthority','FORBIDDEN_NOT_PRESENT_NOT_ACCESSED')
        )
      )
      OR
      (
        receipt_kind='WF_PREDICTIVE'
        AND schema_version='scientific-admission-receipt/v4'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,schemaVersion}'='predictive-terminal-receipt/v3'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,harnessSchemaVersion}'='research-harness-admission/v5'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,scoringContractVersion}'='multiclass-brier-reward/v1'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,scoringMetric}'='terminal-multiclass-brier-reward/v1'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,scoringAmendmentDigestHex}'=
          '694d625c2120d3e5410a7395646bd0bae728ea08e08fc8ea93043061cdb8d8de'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,cdfKernelVersion}'='cdf-erf-cody715/v2'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,cdfAmendmentDigestHex}'=
          '7b8dfb5540833d8e915ecf2456594e366e0fc9c11c8e33f9df6a0732f3d8a09f'
        AND selected_k_config_dec IS NOT NULL AND selected_m_config_dec IS NOT NULL
        AND selected_package_generation_identity_digest IS NOT NULL
        AND selected_package_content_digest IS NOT NULL
        AND receipt_json::jsonb->>'schemaVersion'=schema_version
        AND receipt_json::jsonb->>'organizationId'=organization_id::text
        AND receipt_json::jsonb->>'wfPartition'='WF_PREDICTIVE'
        AND receipt_json::jsonb->>'terminalStatus'='ADMITTED'
        AND receipt_json::jsonb->>'evidenceSemanticDigestHex'=evidence_semantic_digest
        AND receipt_json::jsonb->>'contentDigestHex'=content_digest
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,kmGlobalAnchorSetDigestHex}'=
          km_global_anchor_set_digest
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,replicaRootFamilyIdentityDigestHex}'=
          replica_root_family_identity_digest
        AND (receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedK}')::integer=
          selected_k_config_dec
        AND (receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedM}')::integer=
          selected_m_config_dec
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,alphaEpiConfigScale8}'=
          alpha_epi_config_scale8
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedPackageGenerationIdentityDigestHex}'=
          selected_package_generation_identity_digest
        AND receipt_json::jsonb#>>'{kmConvergenceReceipt,selectedPackageContentDigestHex}'=
          selected_package_content_digest
        AND receipt_json::jsonb#>>'{epistemicParameterRatificationReceipt,contentDigestHex}'=
          public.waia_epistemic_parameter_ratification_v1_content_digest_hex(
            receipt_json::jsonb->'epistemicParameterRatificationReceipt')
        AND EXISTS (
          SELECT 1
          FROM public.trader_historical_technical_proposal_v2 proposal
          JOIN public.trader_historical_proposal_ratification_v2 approval
            ON approval.proposal_id=proposal.id
           AND approval.organization_id=proposal.organization_id
           AND approval.run_id=proposal.run_id
           AND approval.release_sha=proposal.release_sha
           AND approval.proposal_content_digest_hex=proposal.content_digest_hex
          JOIN public.trader_scientific_admission_receipt_v1 aggregate
            ON aggregate.id=(proposal.technical_candidate_json->>
              'aggregateAdmissionReceiptId')::uuid
           AND aggregate.organization_id=proposal.organization_id
           AND aggregate.receipt_kind='WF_PREDICTIVE_FOUR_SURFACE'
           AND aggregate.content_digest=proposal.technical_candidate_json->>
              'aggregateAdmissionContentDigestHex'
          JOIN LATERAL jsonb_array_elements(
            proposal.technical_candidate_json->'surfaces') candidate(surface) ON true
          JOIN LATERAL jsonb_array_elements(
            aggregate.receipt_json::jsonb#>'{sourceAuthority,contract,surfaces}'
          ) frozen(surface) ON frozen.surface->>'surfaceKey'=
              candidate.surface->>'surfaceKey'
          WHERE proposal.organization_id=
              trader_scientific_admission_receipt_v1.organization_id
            AND candidate.surface->>'familyIdentityDigestHex'=
              trader_scientific_admission_receipt_v1.replica_root_family_identity_digest
            AND candidate.surface->>'kmGlobalAnchorSetDigestHex'=
              trader_scientific_admission_receipt_v1.km_global_anchor_set_digest
            AND candidate.surface->>'predictivePackageGenerationIdentityDigestHex'=
              trader_scientific_admission_receipt_v1
                .selected_package_generation_identity_digest
            AND candidate.surface->>'predictivePackageContentDigestHex'=
              trader_scientific_admission_receipt_v1.selected_package_content_digest
            AND candidate.surface->'predictiveTerminalReceipt'=
              trader_scientific_admission_receipt_v1.receipt_json::jsonb->
                'predictiveTerminalReceipt'
            AND frozen.surface->'convergenceReceipt'=
              trader_scientific_admission_receipt_v1.receipt_json::jsonb->
                'kmConvergenceReceipt'
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,verdict}'=
              'RATIFIED'
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedK}'=
              trader_scientific_admission_receipt_v1.selected_k_config_dec::text
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedM}'=
              trader_scientific_admission_receipt_v1.selected_m_config_dec::text
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,alphaEpiConfigScale8}'=
              trader_scientific_admission_receipt_v1.alpha_epi_config_scale8
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedPackageGenerationIdentityDigestHex}'=
              trader_scientific_admission_receipt_v1
                .selected_package_generation_identity_digest
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,selectedPackageContentDigestHex}'=
              trader_scientific_admission_receipt_v1.selected_package_content_digest
            AND trader_scientific_admission_receipt_v1.receipt_json::jsonb#>>
              '{epistemicParameterRatificationReceipt,humanReceiptIdentityDigestHex}'=
              encode(sha256(convert_to(public.waia_canonical_jsonb_v1(jsonb_build_object(
                'schemaVersion','waia.trader.historical_human_ratification_identity.v2',
                'intent','HUMAN_RATIFY_PREDICTIVE_SURFACE_FOR_HISTORICAL_SIMULATION',
                'organizationId',proposal.organization_id::text,
                'runId',proposal.run_id,'releaseSha',proposal.release_sha,
                'operatorUserId',approval.operator_user_id::text,
                'aggregateAdmissionReceiptId',
                  proposal.technical_candidate_json->>'aggregateAdmissionReceiptId',
                'aggregateAdmissionContentDigestHex',
                  proposal.technical_candidate_json->>'aggregateAdmissionContentDigestHex',
                'surfaceKey',candidate.surface->>'surfaceKey',
                'familyIdentityDigestHex',candidate.surface->>'familyIdentityDigestHex',
                'predictiveTerminalReceiptContentDigestHex',
                  candidate.surface#>>'{predictiveTerminalReceipt,contentDigestHex}',
                'kmConvergenceEvidenceSemanticDigestHex',
                  frozen.surface#>>'{convergenceReceipt,evidenceSemanticDigestHex}',
                'selectedK',(frozen.surface#>>'{convergenceReceipt,selectedK}')::integer,
                'selectedM',(frozen.surface#>>'{convergenceReceipt,selectedM}')::integer,
                'predictivePackageGenerationIdentityDigestHex',
                  candidate.surface->>'predictivePackageGenerationIdentityDigestHex',
                'predictivePackageContentDigestHex',
                  candidate.surface->>'predictivePackageContentDigestHex'
              )),'UTF8')),'hex')
        )
      )
    )
  );
